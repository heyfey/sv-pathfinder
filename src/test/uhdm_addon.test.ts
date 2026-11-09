import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// The native UHDM reader. These tests need the addon built against third_party/UHDM
// (scripts/build-uhdm.sh + npm run compile-addon); they are skipped when it is absent so the
// pure-TypeScript unit suite still runs on a checkout without a C++ toolchain.
const ROOT = path.resolve(__dirname, '../..');
const ADDON = path.join(ROOT, 'build', 'Release', 'uhdm_addon.node');
const EXAMPLE_DB = path.join(ROOT, 'examples', 'test', 'surelog.uhdm');

const addon: any = fs.existsSync(ADDON)
    ? require(ADDON)
    : undefined;

suite('uhdm_addon', function () {
    this.timeout(20000);

    setup(function () {
        if (!addon) { this.skip(); }
    });

    test('exports the UHDM version it was built against', () => {
        assert.match(addon.uhdmVersion, /^\d+\.\d+$/);
        // The bundled example database is generated with the matching Surelog release, and the
        // docs (GETTING_STARTED.md, BUILD_SURELOG.md) name that version: keep them in sync.
        const doc = fs.readFileSync(path.join(ROOT, 'BUILD_SURELOG.md'), 'utf8');
        assert.ok(doc.includes(`v${addon.uhdmVersion}`), `BUILD_SURELOG.md does not mention v${addon.uhdmVersion}`);
    });

    test('loads the bundled example database', async () => {
        const id = await addon.loadDesign(EXAMPLE_DB);
        try {
            const tops = await addon.getTopModules(id);
            assert.deepStrictEqual(tops.map((t: any) => t.name), ['work@top']);
            const subs = await addon.getSubScopes(tops[0].handle);
            assert.deepStrictEqual(subs.map((s: any) => s.name).sort(), ['work@top.cif', 'work@top.smc_inst']);
        } finally {
            await addon.unloadDesign(id);
        }
    });

    test('getSourceFiles lists every compiled source file of the design', async () => {
        const id = await addon.loadDesign(EXAMPLE_DB);
        try {
            const files: string[] = addon.getSourceFiles(id);
            assert.ok(files.some(f => f.endsWith('/examples/test/dut.v')), files.join(','));
            assert.ok(files.some(f => f.endsWith('/examples/test/tb.sv')), files.join(','));
        } finally {
            await addon.unloadDesign(id);
        }
        assert.throws(() => addon.getSourceFiles(999999), /Design ID not found/);
    });

    test('rejects (does not abort on) a missing file', async () => {
        await assert.rejects(addon.loadDesign(path.join(ROOT, 'does-not-exist.uhdm')), /Failed to load/);
    });

    test('rejects (does not abort on) a truncated file, without the kj stack dump', async () => {
        const tmp = path.join(ROOT, 'build', 'truncated.test.uhdm');
        fs.writeFileSync(tmp, fs.readFileSync(EXAMPLE_DB).subarray(0, 40000));
        try {
            await assert.rejects(addon.loadDesign(tmp), (err: Error) => {
                assert.match(err.message, /Failed to load .*Premature EOF/);
                assert.doesNotMatch(err.message, /stack:/);
                return true;
            });
        } finally {
            fs.rmSync(tmp, { force: true });
        }
    });
});
