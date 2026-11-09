import * as assert from 'assert';
import { OptionFs, ancestorBases, collectSurelogOptions, loadSurelogOptions, parseCommandLine, surelogCwdCandidates, tokenize } from '../schematic/uhdm_options';

// A fake file system: path -> content ('' for directories/files that just exist).
function fakeFs(files: Record<string, string>): OptionFs {
    const names = Object.keys(files);
    return {
        readFile: p => (p in files ? files[p] : undefined),
        exists: p => p in files,
        subdirs: p => [...new Set(names.filter(n => n.startsWith(p + '/')).map(n => n.slice(p.length + 1).split('/')[0]))],
    };
}

suite('uhdm_options (recover +incdir/+define/-P from Surelog\'s slpp_all/surelog.log)', () => {
    test('parseCommandLine takes the COMMAND: line, tokenize drops comments', () => {
        assert.deepStrictEqual(parseCommandLine('VERSION: 1.87\nCOMMAND: -f a.f -top x -parse -o out\n'), ['-f', 'a.f', '-top', 'x', '-parse', '-o', 'out']);
        assert.strictEqual(parseCommandLine('no command here'), undefined);
        assert.deepStrictEqual(tokenize('+incdir+inc // comment\n# full line comment\n  a.sv   b.sv\n'), ['+incdir+inc', 'a.sv', 'b.sv']);
        assert.deepStrictEqual(tokenize('+define+FF_DELAY=#1 # trailing comment\n'), ['+define+FF_DELAY=#1'], 'a # inside a token is a value, not a comment');
    });

    test('surelogCwdCandidates: relative -o pins the cwd, absolute/no -o falls back to the parent', () => {
        assert.deepStrictEqual(surelogCwdCandidates('/repo/uhdm/tpu/slpp_all', ['-o', 'uhdm/tpu']), ['/repo', '/repo/uhdm/tpu']);
        assert.deepStrictEqual(surelogCwdCandidates('/repo/src/slpp_all', ['-parse']), ['/repo/src']);
        assert.deepStrictEqual(surelogCwdCandidates('/x/out/slpp_all', ['-o', '/x/out']), ['/x/out']);
        // `..` in -o cannot be inverted: only the parent is offered (the -f file's dir covers the rest)
        assert.deepStrictEqual(surelogCwdCandidates('/repo/uhdm/n/slpp_all', ['-o', '../uhdm/n']), ['/repo/uhdm/n']);
    });

    test('collects +incdir+ (multi), +define+ (multi), -P (both spellings), -top, -y and files; ignores the rest', () => {
        const ofs = fakeFs({ '/w/inc': '', '/w/lib': '', '/w/a.sv': '', '/w/b.v': '' });
        const o = collectSurelogOptions(tokenize('+incdir+inc+missing +define+A=1+B -P W=512 -PDEPTH=4 -top top -y lib -parse -elabuhdm -d uhdm -o out a.sv b.v -sverilog'), ['/w'], ofs);
        assert.deepStrictEqual(o.incdirs, ['/w/inc', '/w/lib'], 'an include dir that resolves nowhere is dropped (a missing -I breaks the Yosys command)');
        assert.deepStrictEqual(o.defines, ['A=1', 'B']);
        assert.deepStrictEqual(o.params, [{ name: 'W', value: '512' }, { name: 'DEPTH', value: '4' }]);
        assert.strictEqual(o.top, 'top');
        assert.deepStrictEqual(o.files, ['/w/a.sv', '/w/b.v']);
    });

    test('-f files are read and nested paths resolve against the file\'s own directory first', () => {
        const ofs = fakeFs({
            '/repo/flists/top.f': '+define+NESTED\n-f design.f   // nested, same dir\n../test/tb.sv\n',
            '/repo/flists/design.f': '+incdir+../src\n../src/a.sv\n',
            '/repo/src': '', '/repo/src/a.sv': '', '/repo/test/tb.sv': '',
        });
        const o = collectSurelogOptions(['-f', 'flists/top.f', '-o', 'uhdm/x'], ['/repo'], ofs);
        assert.deepStrictEqual(o.defines, ['NESTED']);
        assert.deepStrictEqual(o.incdirs, ['/repo/src']);
        assert.deepStrictEqual(o.files, ['/repo/src/a.sv', '/repo/test/tb.sv']);
    });

    test('a missing -f file or source file is skipped, not fatal', () => {
        const o = collectSurelogOptions(['-f', 'gone.f', 'nope.sv', '+define+X'], ['/w'], fakeFs({}));
        assert.deepStrictEqual(o, { incdirs: [], defines: ['X'], params: [], files: [] });
    });

    test('ancestorBases: nearest ancestors of the known absolute sources, deduplicated', () => {
        assert.deepStrictEqual(ancestorBases(['/r/designs/x/rtl/a.sv', '/r/designs/x/rtl/b.sv', 'rel.sv'], 3), ['/r/designs/x/rtl', '/r/designs/x', '/r/designs']);
    });

    test('a relative +incdir+ resolves from an ancestor of the known sources when the cwd is unknown (absolute -o)', () => {
        const ofs = fakeFs({
            '/out/slpp_all/surelog.log': 'COMMAND: -f /out/surelog.f -top t -parse -o /out\n',
            '/out/surelog.f': '+incdir+../designs/x/rtl/include\n../designs/x/rtl/a.sv\n',
            '/r/designs/x/rtl/include': '', '/r/designs/x/rtl/a.sv': '',
        });
        const o = loadSurelogOptions('/out/slpp_all/surelog.uhdm', ofs, ['/r/designs/x/rtl/a.sv'])!;
        assert.deepStrictEqual(o.incdirs, ['/r/designs/x/rtl/include']);
        assert.deepStrictEqual(o.files, ['/r/designs/x/rtl/a.sv']);
    });

    test('a relative include dir one level below a base is found when the cwd is unknown', () => {
        const ofs = fakeFs({
            '/out/slpp_all/surelog.log': 'COMMAND: -f /out/surelog.f -parse -o /out\n',
            '/out/surelog.f': '+incdir+rtlmeter_stub\n../designs/d/a.v\n',
            '/repo/flists/rtlmeter_stub': '', '/repo/designs/d/a.v': '',
        });
        const o = loadSurelogOptions('/out/slpp_all/surelog.uhdm', ofs, ['/repo/designs/d/a.v'])!;
        assert.deepStrictEqual(o.incdirs, ['/repo/flists/rtlmeter_stub']);
    });

    test('loadSurelogOptions reads the log next to the database (relative -o cwd rule end to end)', () => {
        const ofs = fakeFs({
            '/repo/uhdm/tpu/slpp_all/surelog.log': 'VERSION: 1.87\nCOMMAND: -f tpu.f -parse -elabuhdm -sverilog -d uhdm -o uhdm/tpu\n',
            '/repo/tpu.f': '+define+SYNTHESIS\n+incdir+./src\nsrc/pe.sv\n',
            '/repo/src': '', '/repo/src/pe.sv': '',
        });
        const o = loadSurelogOptions('/repo/uhdm/tpu/slpp_all/surelog.uhdm', ofs)!;
        assert.deepStrictEqual(o.defines, ['SYNTHESIS']);
        assert.deepStrictEqual(o.incdirs, ['/repo/src']);
        assert.deepStrictEqual(o.files, ['/repo/src/pe.sv']);
        assert.strictEqual(loadSurelogOptions('/nolog/x.uhdm', ofs), undefined);
    });
});
