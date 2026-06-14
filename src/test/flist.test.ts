import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import path from 'path';

import { absolutizeFlist } from '../flist';

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
