import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as tar from 'tar';
import { installFromSource, selfTestRuntime } from '../schematic/runtime_install';

// A fake package: bin/yosys is a shell script that answers `help read_slang` / `help read_uhdm`
// with exit 0 (or 1 when FAKE_FAIL is set), plus a manifest. Served over a local HTTP server, so the
// whole pipeline (download → sha256 → extract → manifest → self-test → atomic move) runs for real.
async function makePackage(dir: string, opts: { version?: string; failSelfTest?: boolean; os?: string } = {}): Promise<string> {
    const name = 'sv-pathfinder-schematic-runtime-linux-x64-0.1.0';
    const pkg = path.join(dir, name);
    await fsp.mkdir(path.join(pkg, 'bin'), { recursive: true });
    await fsp.mkdir(path.join(pkg, 'share', 'yosys', 'plugins'), { recursive: true });
    await fsp.writeFile(path.join(pkg, 'bin', 'yosys'), `#!/bin/sh\necho "fake yosys $*"\nexit ${opts.failSelfTest ? 1 : 0}\n`, { mode: 0o755 });
    await fsp.writeFile(path.join(pkg, 'share', 'yosys', 'plugins', 'uhdm2rtlil.so'), 'not really');
    await fsp.writeFile(path.join(pkg, 'runtime-manifest.json'), JSON.stringify({
        schema: 1, version: opts.version ?? '0.1.0', os: opts.os ?? 'linux', arch: 'x64',
        features: { read_slang: true, read_uhdm: true },
    }));
    const archive = path.join(dir, `${name}.tar.gz`);
    await tar.c({ gzip: true, file: archive, cwd: dir }, [name]);
    return archive;
}

function sha256(file: string): string { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function serve(file: string): Promise<{ url: string; close: () => void }> {
    return new Promise(resolve => {
        const srv = http.createServer((req, res) => {
            if (req.url === '/redirect') { res.writeHead(302, { Location: '/asset.tar.gz' }); res.end(); return; }
            const data = fs.readFileSync(file);
            res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': data.length });
            res.end(data);
        });
        srv.listen(0, '127.0.0.1', () => {
            const port = (srv.address() as any).port;
            resolve({ url: `http://127.0.0.1:${port}/redirect`, close: () => srv.close() });
        });
    });
}

suite('runtime_install', function () {
    this.timeout(20000);
    let tmp: string;
    setup(async () => { tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'svpf-rt-')); });
    teardown(async () => { await fsp.rm(tmp, { recursive: true, force: true }); });
    const expected = { version: '0.1.0', platformKey: 'linux-x64' };

    test('installs a verified package atomically and runs the self-test (follows a redirect)', async () => {
        if (process.platform === 'win32') { return; }
        const archive = await makePackage(path.join(tmp, 'src'));
        const srv = await serve(archive);
        try {
            const installDir = path.join(tmp, 'store', '0.1.0');
            const progress: string[] = [];
            const m = await installFromSource({ url: srv.url, sha256: sha256(archive) }, installDir, expected, { progress: p => progress.push(p) });
            assert.strictEqual(m.version, '0.1.0');
            assert.ok(fs.existsSync(path.join(installDir, 'bin', 'yosys')));
            assert.ok(fs.existsSync(path.join(installDir, 'share', 'yosys', 'plugins', 'uhdm2rtlil.so')));
            assert.ok(progress.some(p => p.startsWith('downloading')) && progress.includes('extracting…') && progress.includes('checking…'));
            // no temp directories left behind
            const left = (await fsp.readdir(path.join(tmp, 'store'))).filter(n => n.startsWith('tmp-'));
            assert.deepStrictEqual(left, []);
        } finally { srv.close(); }
    });

    test('rejects on a SHA-256 mismatch and leaves nothing installed', async () => {
        const archive = await makePackage(path.join(tmp, 'src'));
        const srv = await serve(archive);
        try {
            const installDir = path.join(tmp, 'store', '0.1.0');
            await assert.rejects(installFromSource({ url: srv.url, sha256: 'ab'.repeat(32) }, installDir, expected), /SHA-256 mismatch/);
            assert.ok(!fs.existsSync(installDir));
            assert.deepStrictEqual((await fsp.readdir(path.join(tmp, 'store'))).filter(n => n.startsWith('tmp-')), []);
        } finally { srv.close(); }
    });

    test('rejects when the self-test fails, keeping a previous install intact', async () => {
        if (process.platform === 'win32') { return; }
        const good = await makePackage(path.join(tmp, 'good'));
        const bad = await makePackage(path.join(tmp, 'bad'), { failSelfTest: true });
        const installDir = path.join(tmp, 'store', '0.1.0');
        let srv = await serve(good);
        try { await installFromSource({ url: srv.url, sha256: '' }, installDir, expected); } finally { srv.close(); }
        srv = await serve(bad);
        try {
            await assert.rejects(installFromSource({ url: srv.url, sha256: '' }, installDir, expected), /self-test "read_slang" failed/);
            assert.ok(fs.existsSync(path.join(installDir, 'bin', 'yosys')), 'previous install must survive a failed replacement');
        } finally { srv.close(); }
    });

    test('rejects a package whose manifest is for another platform or version', async () => {
        const archive = await makePackage(path.join(tmp, 'src'), { os: 'darwin' });
        const srv = await serve(archive);
        try {
            await assert.rejects(installFromSource({ url: srv.url, sha256: '' }, path.join(tmp, 'store', '0.1.0'), expected), /this host is linux-x64/);
            await assert.rejects(installFromSource({ url: srv.url, sha256: '' }, path.join(tmp, 'store', '0.1.0'), { version: '9.9.9', platformKey: 'darwin-x64' }), /does not match expected 9\.9\.9/);
        } finally { srv.close(); }
    });

    test('rejects an HTTP error', async () => {
        const srv = http.createServer((_q, res) => { res.writeHead(404); res.end(); });
        await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
        const port = (srv.address() as any).port;
        try {
            await assert.rejects(installFromSource({ url: `http://127.0.0.1:${port}/x`, sha256: '' }, path.join(tmp, 'store', '0.1.0'), expected), /HTTP 404/);
        } finally { srv.close(); }
    });

    test('selfTestRuntime: a yosys that fails read_uhdm is rejected only when read_uhdm is expected', async () => {
        if (process.platform === 'win32') { return; }
        const dir = path.join(tmp, 'rt');
        await fsp.mkdir(path.join(dir, 'bin'), { recursive: true });
        await fsp.writeFile(path.join(dir, 'bin', 'yosys'), '#!/bin/sh\ncase "$*" in *read_uhdm*) exit 3;; esac\nexit 0\n', { mode: 0o755 });
        await selfTestRuntime(dir, { read_slang: true, read_uhdm: false });
        await assert.rejects(selfTestRuntime(dir, { read_slang: true, read_uhdm: true }), /self-test "read_uhdm" failed \(exit 3\)/);
    });
});
