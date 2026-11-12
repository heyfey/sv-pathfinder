import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    RuntimeVersions, assetFor, inferPreload, installDeclinedMessage, installPromptMessage, isSafeArchiveEntry, platformKey,
    resolveOverride, supportedPlatformsText, unsupportedPlatformMessage, validateManifest, yosysArg, yosysArgs, yosysCandidates, yosysPath,
    RUNTIME_ENV_VAR,
} from '../schematic/runtime_policy';

const ROOT = path.resolve(__dirname, '../..');
const versions: RuntimeVersions = JSON.parse(fs.readFileSync(path.join(ROOT, 'toolchain', 'versions.json'), 'utf8'));

suite('runtime_policy', () => {
    test('platformKey joins Node platform and arch', () => {
        assert.strictEqual(platformKey('linux', 'x64'), 'linux-x64');
        assert.strictEqual(platformKey('darwin', 'arm64'), 'darwin-arm64');
        assert.strictEqual(platformKey('win32', 'x64'), 'win32-x64');
    });

    test('toolchain/versions.json pins one asset per platform, all at the runtime version', () => {
        assert.match(versions.runtimeVersion, /^\d+\.\d+\.\d+$/);
        const keys = ['linux-x64', 'darwin-arm64', 'darwin-x64', 'win32-x64'];
        assert.deepStrictEqual(Object.keys(versions.assets).sort(), [...keys].sort());
        for (const key of keys) {
            const a = assetFor(versions, key)!;
            assert.ok(a.url.endsWith(`sv-pathfinder-schematic-runtime-${key}-${versions.runtimeVersion}.tar.gz`), a.url);
            assert.ok(a.url.includes(`schematic-runtime-v${versions.runtimeVersion}/`), 'release tag in URL must carry the version');
            assert.match(a.sha256, /^([0-9a-f]{64})?$/, 'sha256 is 64 hex chars (or empty before the release exists)');
            assert.strictEqual(a.features.read_slang, true);
            // read_uhdm exists only in the from-source Linux build; the OSS CAD Suite repacks are slang-only
            assert.strictEqual(a.features.read_uhdm, key === 'linux-x64', key);
            assert.strictEqual(a.source, key === 'linux-x64' ? undefined : 'oss-cad-suite', key);
        }
        // the repacks pin the exact OSS CAD Suite archive they are made from
        const oss = (versions as any).sources.ossCadSuite;
        assert.match(oss.release, /^\d{4}-\d{2}-\d{2}$/);
        for (const key of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
            const pin = oss.assets[key];
            assert.ok(pin, `ossCadSuite pin for ${key}`);
            assert.ok(pin.name.startsWith('oss-cad-suite-') && pin.name.endsWith(`${oss.release.replace(/-/g, '')}.tgz`), pin.name);
            assert.match(pin.sha256, /^[0-9a-f]{64}$/);
        }
        assert.strictEqual(supportedPlatformsText(versions), 'Linux x64, macOS arm64, macOS x64, Windows x64');
    });

    test('inferPreload: the manifest decides; without one, a slang plugin file means `-m slang`', () => {
        assert.deepStrictEqual(inferPreload({ schema: 1, version: '1', os: 'darwin', arch: 'arm64', features: { read_slang: true, read_uhdm: false }, preload: ['slang'] }, false), ['slang']);
        assert.deepStrictEqual(inferPreload({ schema: 1, version: '1', os: 'linux', arch: 'x64', features: { read_slang: true, read_uhdm: true } }, true), [], 'a manifest without preload wins over the plugin file');
        assert.deepStrictEqual(inferPreload(undefined, true), ['slang'], 'a full OSS CAD Suite install pointed at by hand');
        assert.deepStrictEqual(inferPreload(undefined, false), []);
    });

    test('yosysArgs: preload plugins, then uhdm2rtlil when needed, then the script', () => {
        assert.deepStrictEqual(yosysArgs([], false, 'read_slang a.sv'), ['-p', 'read_slang a.sv']);
        assert.deepStrictEqual(yosysArgs([], true, 's'), ['-m', 'uhdm2rtlil', '-p', 's']);
        assert.deepStrictEqual(yosysArgs(['slang'], false, 's'), ['-m', 'slang', '-p', 's']);
        assert.deepStrictEqual(yosysArgs(['slang'], true, 's'), ['-m', 'slang', '-m', 'uhdm2rtlil', '-p', 's']);
    });

    test('yosysArg: quotes a path with whitespace (Yosys core commands unquote; read_slang does not, so never use it for read_slang arguments)', () => {
        assert.strictEqual(yosysArg('/Users/me/Library/Application Support/x.sv', 'darwin'), '"/Users/me/Library/Application Support/x.sv"');
        assert.strictEqual(yosysArg('/home/me/x.sv', 'linux'), '/home/me/x.sv');
        assert.strictEqual(yosysArg('C:\\Users\\me name\\x.sv', 'win32'), '"C:/Users/me name/x.sv"');
    });

    test('yosysPath: forward slashes on Windows only', () => {
        assert.strictEqual(yosysPath('C:\\Users\\me\\d.f', 'win32'), 'C:/Users/me/d.f');
        assert.strictEqual(yosysPath('/home/me/d.f', 'linux'), '/home/me/d.f');
        assert.strictEqual(yosysPath('a\\b', 'linux'), 'a\\b', 'a backslash is a legal character on POSIX');
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
        const repack = { ...good, os: 'darwin', arch: 'arm64', features: { read_slang: true, read_uhdm: false }, preload: ['slang'] };
        assert.deepStrictEqual(validateManifest(repack, { platformKey: 'darwin-arm64' }), repack);
        assert.match(validateManifest({ ...good, preload: 'slang' }) as string, /"preload"/);
        assert.match(validateManifest({ ...good, preload: ['../evil'] }) as string, /"preload"/);
    });

    test('messages name the actionable override and what the package contains', () => {
        assert.ok(installPromptMessage('0.1.0', '120 MB').includes('v0.1.0 (120 MB)'));
        assert.ok(installPromptMessage('0.2.0', undefined, { read_slang: true, read_uhdm: true }).includes('slang and UHDM frontends'));
        const slangOnly = installPromptMessage('0.2.0', undefined, { read_slang: true, read_uhdm: false });
        assert.ok(slangOnly.includes('slang frontend') && !slangOnly.includes('UHDM'), slangOnly);
        assert.ok(unsupportedPlatformMessage('linux-arm64', 'Linux x64, macOS arm64').includes('linux-arm64'));
        assert.ok(unsupportedPlatformMessage('linux-arm64', 'Linux x64, macOS arm64').includes('built for Linux x64, macOS arm64'));
        assert.ok(unsupportedPlatformMessage('linux-arm64').includes(RUNTIME_ENV_VAR));
        assert.ok(installDeclinedMessage().includes('schematicRuntimePath'));
    });
});
