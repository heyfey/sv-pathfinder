import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    RuntimeVersions, assetFor, installDeclinedMessage, installPromptMessage, isSafeArchiveEntry, platformKey,
    resolveOverride, unsupportedPlatformMessage, validateManifest, yosysCandidates, RUNTIME_ENV_VAR,
} from '../schematic/runtime_policy';

const ROOT = path.resolve(__dirname, '../..');
const versions: RuntimeVersions = JSON.parse(fs.readFileSync(path.join(ROOT, 'toolchain', 'versions.json'), 'utf8'));

suite('runtime_policy', () => {
    test('platformKey joins Node platform and arch', () => {
        assert.strictEqual(platformKey('linux', 'x64'), 'linux-x64');
        assert.strictEqual(platformKey('darwin', 'arm64'), 'darwin-arm64');
        assert.strictEqual(platformKey('win32', 'x64'), 'win32-x64');
    });

    test('toolchain/versions.json pins a linux-x64 asset that matches the runtime version', () => {
        assert.match(versions.runtimeVersion, /^\d+\.\d+\.\d+$/);
        const a = assetFor(versions, 'linux-x64');
        assert.ok(a, 'linux-x64 asset missing');
        assert.ok(a!.url.endsWith(`sv-pathfinder-schematic-runtime-linux-x64-${versions.runtimeVersion}.tar.gz`), a!.url);
        assert.ok(a!.url.includes(`schematic-runtime-v${versions.runtimeVersion}/`), 'release tag in URL must carry the version');
        assert.match(a!.sha256, /^([0-9a-f]{64})?$/, 'sha256 is 64 hex chars (or empty before the release exists)');
        assert.deepStrictEqual(a!.features, { read_slang: true, read_uhdm: true });
        assert.strictEqual(assetFor(versions, 'darwin-arm64'), undefined, 'Stage 2 assets are not pinned yet');
    });

    test('resolveOverride: setting wins, env second, blanks ignored', () => {
        assert.deepStrictEqual(resolveOverride('/a', '/b'), { dir: '/a', source: 'setting' });
        assert.deepStrictEqual(resolveOverride('  ', '/b'), { dir: '/b', source: 'env' });
        assert.deepStrictEqual(resolveOverride(undefined, ' /b '), { dir: '/b', source: 'env' });
        assert.strictEqual(resolveOverride('', ''), undefined);
        assert.strictEqual(resolveOverride(undefined, undefined), undefined);
    });

    test('yosysCandidates: package layout first, then a bin/ directory', () => {
        assert.deepStrictEqual(yosysCandidates('/rt', 'linux'), ['/rt/bin/yosys', '/rt/yosys']);
        assert.deepStrictEqual(yosysCandidates('/rt', 'win32'), ['/rt/bin/yosys.exe', '/rt/yosys.exe']);
    });

    test('isSafeArchiveEntry rejects traversal, absolute paths and links', () => {
        assert.strictEqual(isSafeArchiveEntry('pkg/bin/yosys', 'File'), true);
        assert.strictEqual(isSafeArchiveEntry('pkg/share/yosys/', 'Directory'), true);
        assert.strictEqual(isSafeArchiveEntry('pkg/../../etc/passwd', 'File'), false);
        assert.strictEqual(isSafeArchiveEntry('../x', 'File'), false);
        assert.strictEqual(isSafeArchiveEntry('/etc/passwd', 'File'), false);
        assert.strictEqual(isSafeArchiveEntry('C:\\x', 'File'), false);
        assert.strictEqual(isSafeArchiveEntry('', 'File'), false);
        assert.strictEqual(isSafeArchiveEntry('pkg/bin/yosys', 'SymbolicLink'), false);
        assert.strictEqual(isSafeArchiveEntry('pkg/bin/yosys', 'Link'), false);
        assert.strictEqual(isSafeArchiveEntry('pkg/a..b/file', 'File'), true, 'dots inside a name are fine');
    });

    test('validateManifest accepts the build script shape and rejects mismatches', () => {
        const good = { schema: 1, version: '0.1.0', os: 'linux', arch: 'x64', features: { read_slang: true, read_uhdm: true } };
        assert.deepStrictEqual(validateManifest(good), good);
        assert.deepStrictEqual(validateManifest(good, { version: '0.1.0', platformKey: 'linux-x64' }), good);
        assert.match(validateManifest(good, { version: '0.2.0' }) as string, /does not match expected 0\.2\.0/);
        assert.match(validateManifest(good, { platformKey: 'darwin-arm64' }) as string, /this host is darwin-arm64/);
        assert.match(validateManifest({ ...good, schema: 2 }) as string, /schema 2/);
        assert.match(validateManifest({ ...good, features: { read_slang: true } }) as string, /features/);
        assert.match(validateManifest(null) as string, /not an object/);
        assert.match(validateManifest({ ...good, version: '' }) as string, /"version" missing/);
    });

    test('messages name the actionable override', () => {
        assert.ok(installPromptMessage('0.1.0', '120 MB').includes('v0.1.0 (120 MB)'));
        assert.ok(unsupportedPlatformMessage('darwin-arm64').includes('darwin-arm64'));
        assert.ok(unsupportedPlatformMessage('darwin-arm64').includes(RUNTIME_ENV_VAR));
        assert.ok(installDeclinedMessage().includes('schematicRuntimePath'));
    });
});
