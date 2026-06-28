import path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { randomUUID } from 'crypto';

// Flags whose following token is a path that must be made absolute.
const PATH_FLAGS = new Set(['-y', '-v', '--libdir', '-l']);
// Flags whose following token is itself a nested command file (.f) to recurse into.
const NESTED_FLAGS = new Set(['-f', '-F', '-C']);
// Flags whose following token is a NON-path argument (a macro, param, module, or value) that must NOT
// be absolutized — otherwise e.g. `-D MACRO` would become `-D /abs/dir/MACRO`, which slang reads from
// the original .f but read_slang reads from our rewritten copy. The attached forms (`-DMACRO`,
// `+define+MACRO`) already pass through untouched as single tokens.
const NONPATH_ARG_FLAGS = new Set(['-D', '--define-macro', '-G', '--param-override', '--top', '-top', '--std', '--timescale']);

// Resolve relative paths inside a .f command file against the file's own
// directory, writing an absolutized copy to a temp file. Returns the temp path.
// Nested command files (-f/-F/-C) are rewritten too and the parent is pointed at
// the rewritten copy, so relative entries at any depth become absolute.
//
// Needed because slang-server resolves relative .f entries against the server's
// CWD (which we don't control, since the slang extension spawns the server),
// unlike Surelog which we spawn ourselves with cwd: flistDir.
export async function absolutizeFlist(flistPath: string): Promise<string> {
    return rewrite(path.resolve(flistPath), new Map(), new Set());
}

function quoteArg(p: string): string {
    return /\s/.test(p) ? `"${p}"` : p;
}

// Build read_slang/read_verilog search-path flags from a set of directories, so a PARTIAL filelist
// still elaborates. Each dir becomes an include path (-I) and, for read_slang (withLibdir), a
// library search dir (-y, with .sv/.v libext) so slang auto-resolves instantiated modules the .f
// doesn't list (e.g. a curated .f that omits sibling sources). Dirs are deduped; blanks dropped.
export function searchDirFlags(dirs: string[], withLibdir: boolean): string {
    const uniq = [...new Set(dirs.map((d) => (d || '').trim()).filter(Boolean))];
    if (uniq.length === 0) { return ''; }
    const flags: string[] = [];
    for (const d of uniq) {
        flags.push(`-I ${quoteArg(d)}`);
        if (withLibdir) { flags.push(`-y ${quoteArg(d)}`); }
    }
    if (withLibdir) { flags.push('--libext .sv', '--libext .v'); }
    return flags.join(' ');
}

// read_slang flags that blackbox a scope's direct child modules — "selected + 1 level" elaboration:
// the child interiors are NOT elaborated (saves time/memory); they appear as port-only boxes. Deduped
// and quoted like searchDirFlags. Empty input → empty string.
export function blackboxFlags(childModules: string[]): string {
    const uniq = [...new Set(childModules.map((m) => (m || '').trim()).filter(Boolean))];
    return uniq.map((m) => `--blackboxed-module ${quoteArg(m)}`).join(' ');
}

// A source file is verification-only (non-synthesizable) if it imports the UVM/OVM package or includes
// the UVM/OVM macros. read_slang compiles every file in the filelist, so even one such file (anywhere,
// instantiated or not) fails the whole elaboration — which is why a generated .f that bundles
// verification sources can't be rendered as-is.
const UVM_SOURCE = /^[ \t]*(import[ \t]+(uvm|ovm)_pkg\b|`include[ \t]+"(uvm|ovm)_macros\.svh")/m;
export function isUvmSource(content: string): boolean {
    return UVM_SOURCE.test(content);
}

// The single source-file path on a .f line, if any: a bare path, or the arg of -v/-l/--libfile. Returns
// null for option / +incdir+ / +define+ / nested -f lines (no single source to test) and comments.
function sourceFileInLine(line: string): string | null {
    const toks = line.replace(/\/\/.*$/, '').replace(/(^|\s)#.*$/, '$1').trim().split(/\s+/).filter(Boolean);
    if (toks.length === 0) { return null; }
    if ((toks[0] === '-v' || toks[0] === '-l' || toks[0] === '--libfile') && toks[1]) { return toks[1]; }
    if (toks[0].startsWith('+') || toks[0].startsWith('-')) { return null; }
    return toks[0];
}

// A file defines `module/interface/program <name>` (used to tell whether a dropped file is the very
// scope we were asked to render).
function definesModule(content: string, name: string): boolean {
    return new RegExp(`\\b(module|interface|program)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(content);
}

// WORKAROUND for verification-laden filelists: write a copy of an (absolutized) .f with every
// UVM/OVM-importing SOURCE file COMMENTED OUT (slang treats '#' as a comment) under an explanatory
// header — the dropped lines are kept (commented), not deleted, and the original .f is untouched.
// Returns the new path, the dropped files, and `topDropped` (true if `topModule`'s own definition was
// in a dropped file — i.e. the scope we're rendering is itself UVM, so it'll come back empty), or null
// if nothing was found. Callers must pass --ignore-unknown-modules so the dropped modules' instances
// render as blackboxes, not errors.
export async function flistWithoutUvm(flistPath: string, outDir: string, topModule?: string): Promise<{ path: string; dropped: string[]; topDropped: boolean } | null> {
    const raw = await fs.readFile(flistPath, 'utf8');
    const contents = new Map<string, string | null>(); // file -> content (null if unreadable), read once
    const dropped: string[] = [];
    let topDropped = false;
    const lines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const file = sourceFileInLine(line);
        if (file) {
            if (!contents.has(file)) {
                try { contents.set(file, await fs.readFile(file, 'utf8')); }
                catch { contents.set(file, null); } // unreadable → leave it for read_slang to report
            }
            const content = contents.get(file);
            if (content && isUvmSource(content)) {
                dropped.push(file);
                if (topModule && definesModule(content, topModule)) { topDropped = true; }
                lines.push(`# [sv-pathfinder] dropped — imports UVM/OVM, not synthesizable; rendered as a blackbox:`);
                lines.push(`# ${line.trim()}`);
                continue;
            }
        }
        lines.push(line);
    }
    if (dropped.length === 0) { return null; }
    const header =
        '# [sv-pathfinder] SCHEMATIC WORKAROUND — your original filelist is NOT modified.\n' +
        '# The lines marked "dropped" below import UVM/OVM, which is testbench-only and not\n' +
        '# synthesizable, so the schematic backend (read_slang) cannot compile them. They are\n' +
        '# commented out for the schematic only; their modules are imported as blackboxes via\n' +
        '# --ignore-unknown-modules.\n#\n';
    const outPath = path.join(outDir, `sv-pathfinder-nouvm-${randomUUID()}.f`);
    await fs.writeFile(outPath, header + lines.join('\n'));
    return { path: outPath, dropped, topDropped };
}

// `cache` maps an original (resolved) .f path to its rewritten temp copy so a
// file included from multiple parents is only rewritten once. `inProgress`
// breaks include cycles: a file that includes itself (transitively) falls back
// to its original absolute path rather than recursing forever.
async function rewrite(flistPath: string, cache: Map<string, string>, inProgress: Set<string>): Promise<string> {
    const cached = cache.get(flistPath);
    if (cached !== undefined) { return cached; }
    if (inProgress.has(flistPath)) { return flistPath; }
    inProgress.add(flistPath);

    const base = path.dirname(flistPath);
    const abs = (p: string) => (path.isAbsolute(p) ? p : path.resolve(base, p));

    const raw = await fs.readFile(flistPath, 'utf8');
    const out: string[] = [];
    for (const rawLine of raw.split(/\r?\n/)) {
        // Strip // and #-style line comments (tool-generated filelists often use #). slang treats
        // both as comments, so without this their words get absolutized into bogus source paths —
        // and a `.py` generator path mentioned in such a comment becomes a real file slang then parses.
        // Only strip # at a token boundary (start/after space) so a literal `foo#bar.sv` survives.
        const noComment = rawLine.replace(/\/\/.*$/, '').replace(/(^|\s)#.*$/, '$1');
        const toks = noComment.trim().split(/\s+/).filter(Boolean);
        if (toks.length === 0) { out.push(rawLine); continue; }

        const res: string[] = [];
        for (let i = 0; i < toks.length; i++) {
            const t = toks[i];
            if (t.startsWith('+incdir+')) {
                const dirs = t.slice('+incdir+'.length).split('+').filter(Boolean).map(abs);
                res.push('+incdir+' + dirs.join('+'));
            } else if (NESTED_FLAGS.has(t) && i + 1 < toks.length) {
                res.push(t, await rewrite(abs(toks[++i]), cache, inProgress));  // nested .f
            } else if (PATH_FLAGS.has(t) && i + 1 < toks.length) {
                res.push(t, abs(toks[++i]));                    // flag + its path arg
            } else if (NONPATH_ARG_FLAGS.has(t) && i + 1 < toks.length) {
                res.push(t, toks[++i]);                         // flag + its non-path arg, kept verbatim
            } else if (t.startsWith('+') || t.startsWith('-')) {
                res.push(t);                                    // other option, leave as-is
            } else {
                res.push(abs(t));                               // bare file path / glob
            }
        }
        out.push(res.join(' '));
    }

    const tmp = path.join(os.tmpdir(), `sv-pathfinder-${randomUUID()}.f`);
    await fs.writeFile(tmp, out.join('\n'));
    inProgress.delete(flistPath);
    cache.set(flistPath, tmp);
    return tmp;
}
