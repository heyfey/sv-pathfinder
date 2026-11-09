// Recover the compile options of a .uhdm database from Surelog's own records, for the read_slang
// fallback: the database carries the elaborated design but not the +incdir+/+define+/-P options it
// was built with, and re-parsing the sources without them fails on real designs (hdmi needs
// +define+VERILATOR, RTLMeter designs need their stub include dir, verilog-pcie needs a -P).
//
// Surelog writes `slpp_all/surelog.log` next to `surelog.uhdm` with a `COMMAND:` line holding the
// exact arguments, which may reference `-f` files (resolved here, recursively). Pure functions take
// callbacks for the file system so they can be unit-tested; loadSurelogOptions() binds the real fs.
import * as fs from 'fs';
import * as path from 'path';

export interface SurelogOptions {
    incdirs: string[];                         // +incdir+ and -y directories, absolute when resolvable
    defines: string[];                         // NAME or NAME=VALUE, as given to +define+
    params: { name: string; value: string }[]; // -P top-level parameter overrides
    top?: string;                              // -top / --top-module
    files: string[];                           // source files named on the command line / in -f files
}

export interface OptionFs {
    readFile: (p: string) => string | undefined;
    exists: (p: string) => boolean;
    // Subdirectory names of a directory ([] when unreadable). Used to find a relative include
    // directory one level below a base when Surelog's cwd is unknown.
    subdirs?: (p: string) => string[];
}

// The tokens of the `COMMAND:` line of a Surelog log, or undefined when there is none.
export function parseCommandLine(logText: string): string[] | undefined {
    const m = /^COMMAND:\s*(.*)$/m.exec(logText);
    if (!m) { return undefined; }
    return tokenize(m[1]);
}

// Split option text (a command line or a -f file) into tokens. `//` comments and `#` comments are
// dropped, but a `#` inside a token is kept: `+define+FF_DELAY=#1` is a real value, not a comment.
export function tokenize(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\/\/.*$/, '').replace(/(^|\s)#.*$/, '').trim();
        if (line) { out.push(...line.split(/\s+/)); }
    }
    return out;
}

// Where Surelog's working directory was, inferred from `-o <out>`: the output directory is
// <cwd>/<out>/slpp_all, so a relative <out> without `..` pins <cwd> exactly. Without -o, slpp_all
// is created in the cwd. Returns candidates, most likely first; the -f file's own directory is
// added by the caller when resolving paths inside that file.
export function surelogCwdCandidates(slppAllDir: string, tokens: string[]): string[] {
    const parent = path.dirname(slppAllDir);
    const i = tokens.indexOf('-o');
    const out = i >= 0 ? tokens[i + 1] : undefined;
    const cands: string[] = [];
    if (!out) {
        cands.push(parent);
    } else if (path.isAbsolute(out)) {
        cands.push(parent);
    } else {
        const segs = out.split(/[\\/]+/).filter(s => s && s !== '.');
        if (!segs.includes('..')) {
            cands.push(path.resolve(parent, segs.map(() => '..').join('/') || '.'));
        }
        cands.push(parent);
    }
    return [...new Set(cands)];
}

function resolveIn(p: string, bases: string[], ofs: OptionFs, mustExist: boolean): string | undefined {
    if (path.isAbsolute(p)) { return !mustExist || ofs.exists(p) ? p : undefined; }
    for (const b of bases) {
        const abs = path.resolve(b, p);
        if (ofs.exists(abs)) { return abs; }
    }
    return mustExist ? undefined : (bases.length ? path.resolve(bases[0], p) : p);
}

// A relative include directory when no base resolves it directly: look one level below each base
// (Surelog was typically run from a project subdirectory such as flists/ that is not an ancestor of
// the sources). Returns an existing directory or undefined — a non-existent -I/-y makes Yosys fail
// the whole read_slang command with "Bad command", so callers must drop unresolved entries.
function resolveDir(p: string, bases: string[], ofs: OptionFs): string | undefined {
    const direct = resolveIn(p, bases, ofs, true);
    if (direct) { return direct; }
    if (path.isAbsolute(p) || !ofs.subdirs) { return undefined; }
    for (const b of bases) {
        for (const sub of ofs.subdirs(b)) {
            const abs = path.resolve(b, sub, p);
            if (ofs.exists(abs)) { return abs; }
        }
    }
    return undefined;
}

// Walk the tokens (recursing into -f/-F files) and collect what the read_slang fallback needs.
export function collectSurelogOptions(tokens: string[], bases: string[], ofs: OptionFs, depth = 0, acc?: SurelogOptions): SurelogOptions {
    const o = acc ?? { incdirs: [], defines: [], params: [], files: [] };
    if (depth > 8) { return o; }
    const add = (arr: string[], v: string) => { if (!arr.includes(v)) { arr.push(v); } };
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const next = () => tokens[++i];
        if (t.startsWith('+incdir+')) {
            for (const d of t.slice(8).split('+').filter(Boolean)) { const r = resolveDir(d, bases, ofs); if (r) { add(o.incdirs, r); } }
        } else if (t.startsWith('+define+')) {
            for (const d of t.slice(8).split('+').filter(Boolean)) { add(o.defines, d); }
        } else if (t === '-y') {
            const d = next(); const r = d ? resolveDir(d, bases, ofs) : undefined; if (r) { add(o.incdirs, r); }
        } else if (t === '-P') {
            const v = next(); if (v) { pushParam(o, v); }
        } else if (t.startsWith('-P') && t.includes('=')) {
            pushParam(o, t.slice(2));
        } else if (t === '-top' || t === '--top-module') {
            const v = next(); if (v) { o.top = v; }
        } else if (t === '-f' || t === '-F') {
            const f = next();
            const abs = f ? resolveIn(f, bases, ofs, true) : undefined;
            const text = abs ? ofs.readFile(abs) : undefined;
            if (abs && text !== undefined) {
                collectSurelogOptions(tokenize(text), [path.dirname(abs), ...bases], ofs, depth + 1, o);
            }
        } else if (['-o', '-mt', '--threads', '-l', '-timescale', '-cd', '-wd', '-builtin'].includes(t)) {
            next(); // options with an argument we do not need
        } else if (t.startsWith('-') || t.startsWith('+')) {
            // flags without arguments (-parse, -elabuhdm, -sverilog, -d uhdm handled below) — ignore
            if (t === '-d') { next(); }
        } else {
            const abs = resolveIn(t, bases, ofs, true);
            if (abs) { add(o.files, abs); }
        }
    }
    return o;
}

function pushParam(o: SurelogOptions, v: string) {
    const eq = v.indexOf('=');
    if (eq <= 0) { return; }
    const name = v.slice(0, eq), value = v.slice(eq + 1);
    const idx = o.params.findIndex(p => p.name === name);
    if (idx >= 0) { o.params[idx] = { name, value }; } else { o.params.push({ name, value }); }
}

// Surelog's cwd is unknown when -o was absolute, yet relative +incdir+ entries must still resolve.
// The database records every source file with an absolute path, so the ancestors of those files are
// good extra bases: `../designs/x/rtl/include` relative to a filelist in <repo>/flists resolves from
// the ancestor <repo>/designs as well. Nearest ancestors first, deduplicated.
export function ancestorBases(files: string[], maxDepth = 6): string[] {
    const out: string[] = [];
    for (const f of files) {
        if (!path.isAbsolute(f)) { continue; }
        let d = path.dirname(f);
        for (let i = 0; i < maxDepth && d !== path.dirname(d); i++, d = path.dirname(d)) {
            if (!out.includes(d)) { out.push(d); }
        }
    }
    return out;
}

// The real-fs entry point: options for the database at `uhdmPath`, or undefined when no log is found.
// `knownFiles` (absolute source paths from the database) widen the bases for relative paths.
export function loadSurelogOptions(uhdmPath: string, ofs: OptionFs = realFs, knownFiles: string[] = []): SurelogOptions | undefined {
    const dir = path.dirname(uhdmPath);
    const log = ofs.readFile(path.join(dir, 'surelog.log'));
    if (log === undefined) { return undefined; }
    const tokens = parseCommandLine(log);
    if (!tokens) { return undefined; }
    return collectSurelogOptions(tokens, [...surelogCwdCandidates(dir, tokens), ...ancestorBases(knownFiles)], ofs);
}

const realFs: OptionFs = {
    readFile: p => { try { return fs.readFileSync(p, 'utf8'); } catch { return undefined; } },
    exists: p => fs.existsSync(p),
    subdirs: p => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } },
};
