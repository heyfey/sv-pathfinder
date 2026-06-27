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
        const noComment = rawLine.replace(/\/\/.*$/, '');      // strip // comments
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
