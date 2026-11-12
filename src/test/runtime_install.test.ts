import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as tar from 'tar';
import { installFromSource, selfTestRuntime } from '../schematic/runtime_install';

// A fake yosys: a shell script that records its arguments in bin/args.log, writes a one-module JSON
// wherever the script says `write_json <path>` (so the read_slang self-test finds module t), and prints
// a help text for `help read_uhdm`. With `broken`, read_slang fails like a missing frontend would.
function fakeYosys(broken = false, noUhdmPlugin = false): string {
    const script = '#!/bin/sh\n' +
        'echo "$*" >> "$(dirname "$0")/args.log"\n' +
        'script=""; while [ $# -gt 0 ]; do [ "$1" = -m ] && [ "$2" = uhdm2rtlil ] && [ -n "$NO_UHDM" ] && { echo "ERROR: Can\'t load module"; exit 1; }; [ "$1" = -p ] && script="$2"; shift; done\n' +
        'case "$script" in *help\\ read_uhdm*) echo "read_uhdm [options] file.uhdm"; exit 0;; esac\n' +
        (broken ? 'echo "ERROR: fake frontend missing"; exit 1\n' :
            'out="$(printf %s "$script" | sed -n \'s/.*write_json \\([^;]*\\).*/\\1/p\' | sed \'s/^"//; s/"$//\')"\n' +
            '[ -n "$out" ] && printf \'{"modules":{"t":{}}}\' > "$out"\n' +
            'exit 0\n');
    return script.replace('[ -n "$NO_UHDM" ]', noUhdmPlugin ? 'true' : 'false');
}

// A fake package: bin/yosys is the script above, plus a manifest. Served over a local HTTP server,
// so the whole pipeline (download → sha256 → extract → manifest → self-test → atomic move) runs for real.
async function makePackage(dir: string, opts: { version?: string; failSelfTest?: boolean; os?: string; preload?: string[] } = {}): Promise<string> {
    const name = 'sv-pathfinder-schematic-runtime-linux-x64-0.1.0';
    const pkg = path.join(dir, name);
    await fsp.mkdir(path.join(pkg, 'bin'), { recursive: true });
    await fsp.mkdir(path.join(pkg, 'share', 'yosys', 'plugins'), { recursive: true });
    await fsp.writeFile(path.join(pkg, 'bin', 'yosys'), fakeYosys(opts.failSelfTest), { mode: 0o755 });
    await fsp.writeFile(path.join(pkg, 'share', 'yosys', 'plugins', 'uhdm2rtlil.so'), 'not really');
    await fsp.writeFile(path.join(pkg, 'runtime-manifest.json'), JSON.stringify({
        schema: 1, version: opts.version ?? '0.1.0', os: opts.os ?? 'linux', arch: 'x64',
        features: { read_slang: true, read_uhdm: true },
        ...(opts.preload ? { preload: opts.preload } : {}),
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
            // the self-test ran read_slang on a real file and asked the plugin for read_uhdm, nothing else was left behind
            const calls = (await fsp.readFile(path.join(installDir, 'bin', 'args.log'), 'utf8')).trim().split('\n');
            assert.strictEqual(calls.length, 2, calls.join(' // '));
            assert.strictEqual(calls[0], '-p read_slang t.sv --top t; hierarchy -top t; proc; write_json t.json', 'bare names: the probe dir is the cwd');
            assert.match(calls[1], /^-m uhdm2rtlil -p help read_uhdm$/);
            assert.ok(!fs.existsSync(path.join(installDir, 'selftest')), 'self-test scratch dir is removed');
            // no temp directories left behind
            const left = (await fsp.readdir(path.join(tmp, 'store'))).filter(n => n.startsWith('tmp-'));
            assert.deepStrictEqual(left, []);
        } finally { srv.close(); }
    });

    test('installs into a directory whose path has a space (macOS: "Application Support")', async () => {
        if (process.platform === 'win32') { return; }
        const archive = await makePackage(path.join(tmp, 'src'));
        const srv = await serve(archive);
        try {
            const installDir = path.join(tmp, 'Application Support', 'store', '0.1.0');
            await installFromSource({ url: srv.url, sha256: '' }, installDir, expected);
            const calls = (await fsp.readFile(path.join(installDir, 'bin', 'args.log'), 'utf8')).trim().split('\n');
            assert.ok(!calls[0].includes('Application Support'), 'no absolute path reaches read_slang (it keeps quotes verbatim): ' + calls[0]);
            assert.match(calls[0], /^-p read_slang t\.sv --top t; /);
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

    test('a manifest with preload makes every run load those plugins first (OSS CAD Suite repacks)', async () => {
        if (process.platform === 'win32') { return; }
        const archive = await makePackage(path.join(tmp, 'src'), { preload: ['slang'] });
        const srv = await serve(archive);
        try {
            const installDir = path.join(tmp, 'store', '0.1.0');
            const m = await installFromSource({ url: srv.url, sha256: '' }, installDir, expected);
            assert.deepStrictEqual(m.preload, ['slang']);
            const calls = (await fsp.readFile(path.join(installDir, 'bin', 'args.log'), 'utf8')).trim().split('\n');
            assert.match(calls[0], /^-m slang -p read_slang /);
            assert.match(calls[1], /^-m slang -m uhdm2rtlil -p help read_uhdm$/);
        } finally { srv.close(); }
    });

    test('selfTestRuntime: read_slang must produce the module, read_uhdm only when expected', async () => {
        if (process.platform === 'win32') { return; }
        const base = { schema: 1, version: '0.1.0', os: 'linux', arch: 'x64' };
        // a yosys whose uhdm2rtlil plugin is missing: `-m uhdm2rtlil` fails to load
        const dir = path.join(tmp, 'rt');
        await fsp.mkdir(path.join(dir, 'bin'), { recursive: true });
        await fsp.writeFile(path.join(dir, 'bin', 'yosys'), fakeYosys(false, true), { mode: 0o755 });
        await selfTestRuntime(dir, { ...base, features: { read_slang: true, read_uhdm: false } });
        await assert.rejects(selfTestRuntime(dir, { ...base, features: { read_slang: true, read_uhdm: true } }), /self-test "read_uhdm" failed \(exit 1\)/);
        // a yosys that exits 0 but never writes the JSON (read_slang is not there; `help` is polite about it)
        const silent = path.join(tmp, 'silent');
        await fsp.mkdir(path.join(silent, 'bin'), { recursive: true });
        await fsp.writeFile(path.join(silent, 'bin', 'yosys'), '#!/bin/sh\necho "No such command: read_slang"\nexit 0\n', { mode: 0o755 });
        await assert.rejects(selfTestRuntime(silent, { ...base, features: { read_slang: true, read_uhdm: false } }), /self-test "read_slang" failed \(exit 0\)/);
    });
});
