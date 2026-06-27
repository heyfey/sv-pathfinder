import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import path from 'path';

import { absolutizeFlist, searchDirFlags, blackboxFlags } from '../flist';

suite('searchDirFlags', () => {
    test('read_slang form: each dir → -I and -y, plus .sv/.v libext', () => {
        const f = searchDirFlags(['/a/rtl', '/vendor/prim'], true);
        assert.ok(f.includes('-I /a/rtl') && f.includes('-y /a/rtl'));
        assert.ok(f.includes('-I /vendor/prim') && f.includes('-y /vendor/prim'));
        assert.ok(f.includes('--libext .sv') && f.includes('--libext .v'));
    });

    test('read_verilog form (withLibdir=false): include dirs only, no -y/--libext', () => {
        const f = searchDirFlags(['/a/rtl'], false);
        assert.strictEqual(f, '-I /a/rtl');
    });

    test('dedupes dirs and drops blanks', () => {
        const f = searchDirFlags(['/a', '/a', '', '  '], true);
        assert.strictEqual(f, '-I /a -y /a --libext .sv --libext .v');
    });

    test('empty input → empty string (no flags)', () => {
        assert.strictEqual(searchDirFlags([], true), '');
        assert.strictEqual(searchDirFlags(['', ' '], false), '');
    });

    test('quotes directories containing spaces', () => {
        const f = searchDirFlags(['/a b/rtl'], false);
        assert.strictEqual(f, '-I "/a b/rtl"');
    });
});

suite('blackboxFlags', () => {
    test('one --blackboxed-module per child module', () => {
        assert.strictEqual(blackboxFlags(['mod_a', 'mod_b']), '--blackboxed-module mod_a --blackboxed-module mod_b');
    });
    test('dedupes and drops blanks', () => {
        assert.strictEqual(blackboxFlags(['m', 'm', '', '  ']), '--blackboxed-module m');
    });
    test('empty input → empty string', () => {
        assert.strictEqual(blackboxFlags([]), '');
    });
});

// Tokens that introduce a nested command file (its contents are themselves a .f).
const NESTED_FLAGS = new Set(['-f', '-F', '-C']);

// Split a rewritten .f into bare source paths, nested-command-file targets, and
// +incdir+ directories — skipping comments and non-path options.
function classify(content: string): { sources: string[]; nested: string[]; incdirs: string[] } {
    const sources: string[] = [];
    const nested: string[] = [];
    const incdirs: string[] = [];
    for (const rawLine of content.split(/\r?\n/)) {
        const toks = rawLine.replace(/\/\/.*$/, '').trim().split(/\s+/).filter(Boolean);
        for (let i = 0; i < toks.length; i++) {
            const t = toks[i];
            if (t.startsWith('+incdir+')) {
                incdirs.push(...t.slice('+incdir+'.length).split('+').filter(Boolean));
            } else if (NESTED_FLAGS.has(t) && i + 1 < toks.length) {
                nested.push(toks[++i]);
            } else if (t.startsWith('+') || t.startsWith('-')) {
                if (i + 1 < toks.length && !toks[i + 1].startsWith('+') && !toks[i + 1].startsWith('-')) {
                    i++; // skip the arg of any other path-flag (e.g. -y dir)
                }
            } else {
                sources.push(t);
            }
        }
    }
    return { sources, nested, incdirs };
}

// Assert every token reachable from `flistFile` (recursing into nested .f) is an
// absolute path that exists on disk.
function assertAllAbsoluteAndExist(flistFile: string) {
    assert.ok(path.isAbsolute(flistFile), `flist path not absolute: ${flistFile}`);
    assert.ok(fs.existsSync(flistFile), `flist does not exist: ${flistFile}`);
    const { sources, nested, incdirs } = classify(fs.readFileSync(flistFile, 'utf8'));
    for (const s of [...sources, ...incdirs]) {
        assert.ok(path.isAbsolute(s), `path not absolutized: ${s} (in ${flistFile})`);
        assert.ok(fs.existsSync(s), `path does not exist after rewrite: ${s} (in ${flistFile})`);
    }
    for (const n of nested) {
        assertAllAbsoluteAndExist(n); // recurse into nested command file
    }
}

suite('absolutizeFlist', () => {
    let work: string;

    setup(async () => {
        work = await fsp.mkdtemp(path.join(os.tmpdir(), 'flist-test-'));
    });

    teardown(async () => {
        await fsp.rm(work, { recursive: true, force: true });
    });

    test('absolutizes bare relative source paths against the .f directory', async () => {
        await fsp.writeFile(path.join(work, 'a.sv'), '');
        await fsp.writeFile(path.join(work, 'b.sv'), '');
        const flist = path.join(work, 'files.f');
        await fsp.writeFile(flist, '// comment\na.sv\nb.sv\n');

        const out = await absolutizeFlist(flist);
        const { sources } = classify(await fsp.readFile(out, 'utf8'));
        assert.deepStrictEqual(sources.sort(), [path.join(work, 'a.sv'), path.join(work, 'b.sv')].sort());
    });

    test('absolutizes +incdir+ directories and leaves +define+ untouched', async () => {
        await fsp.mkdir(path.join(work, 'inc'));
        await fsp.writeFile(path.join(work, 'top.sv'), '');
        const flist = path.join(work, 'files.f');
        await fsp.writeFile(flist, '+define+FOO=1\n+incdir+inc\ntop.sv\n');

        const content = await fsp.readFile(await absolutizeFlist(flist), 'utf8');
        assert.ok(content.includes('+define+FOO=1'), 'plain +define+ should be preserved');
        const { incdirs } = classify(content);
        assert.deepStrictEqual(incdirs, [path.join(work, 'inc')]);
    });

    test('does not absolutize non-path flag arguments (-D / -G / --top / --std)', async () => {
        // `-D MACRO` etc. must survive verbatim — a bare token after these flags is a macro/param/
        // module/value, not a file. Without the guard the arg becomes `/work/MACRO` and read_slang
        // sees a corrupted filelist while slang (reading the original .f) does not.
        await fsp.writeFile(path.join(work, 'top.sv'), '');
        const flist = path.join(work, 'files.f');
        await fsp.writeFile(flist, '-D MACRO\n-D WIDTH=8\n-G P=1\n--top dut\n--std 1800-2017\ntop.sv\n');

        const content = await fsp.readFile(await absolutizeFlist(flist), 'utf8');
        for (const verbatim of ['-D MACRO', '-D WIDTH=8', '-G P=1', '--top dut', '--std 1800-2017']) {
            assert.ok(content.includes(verbatim), `expected "${verbatim}" kept verbatim, got:\n${content}`);
        }
        // The only absolutized entry is the real source file.
        assert.ok(content.includes(path.join(work, 'top.sv')));
        assert.ok(!content.includes(path.join(work, 'MACRO')), 'macro name must not be turned into a path');
    });

    test('recurses into nested -f command files (paths relative to the nested file)', async () => {
        // Layout:
        //   top.f         -> "-f sub/inner.f" + "rtl/top.sv"
        //   rtl/top.sv
        //   sub/inner.f   -> "leaf.sv" + "../rtl/extra.sv"   (relative to sub/)
        //   sub/leaf.sv
        //   rtl/extra.sv
        await fsp.mkdir(path.join(work, 'rtl'));
        await fsp.mkdir(path.join(work, 'sub'));
        await fsp.writeFile(path.join(work, 'rtl', 'top.sv'), '');
        await fsp.writeFile(path.join(work, 'rtl', 'extra.sv'), '');
        await fsp.writeFile(path.join(work, 'sub', 'leaf.sv'), '');
        await fsp.writeFile(path.join(work, 'sub', 'inner.f'), '// nested\nleaf.sv\n../rtl/extra.sv\n');
        const top = path.join(work, 'top.f');
        await fsp.writeFile(top, '-f sub/inner.f\nrtl/top.sv\n');

        const out = await absolutizeFlist(top);

        // Every path, including those inside the nested command file, must be
        // absolute and exist — otherwise slang-server resolves them against its
        // own CWD and the build fails.
        assertAllAbsoluteAndExist(out);
    });
});
