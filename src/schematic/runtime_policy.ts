// vscode-free policy for the managed schematic runtime (Yosys + read_slang + read_uhdm), so it can be
// unit-tested: which release asset fits this host, how an override is chosen, what an archive entry
// may look like, and what a valid runtime manifest is. The I/O lives in runtime_manager.ts.

export interface RuntimeFeatures {
    read_slang: boolean;
    read_uhdm: boolean;
}

// One downloadable package, as pinned in toolchain/versions.json.
export interface RuntimeAsset {
    url: string;
    sha256: string;          // hex, 64 chars; empty only before the release exists
    features: RuntimeFeatures;
    glibcFloor?: string;
}

export interface RuntimeVersions {
    runtimeVersion: string;
    manifestSchema: number;
    assets: Record<string, RuntimeAsset>;   // keyed by platformKey(), e.g. "linux-x64"
}

// runtime-manifest.json inside an installed package (written by toolchain/build-schematic-runtime.sh).
export interface RuntimeManifest {
    schema: number;
    version: string;
    os: string;
    arch: string;
    features: RuntimeFeatures;
    sources?: Record<string, string>;
}

// Environment variable that points at a runtime directory (second in precedence after the setting).
export const RUNTIME_ENV_VAR = 'SV_PATHFINDER_SCHEMATIC_RUNTIME';
export const RUNTIME_SETTING = 'schematicRuntimePath';
// The plugin name `yosys -m` resolves in <runtime>/share/yosys/plugins/.
export const UHDM_PLUGIN = 'uhdm2rtlil';

// "linux-x64", "darwin-arm64", "win32-x64": Node's platform/arch names, which are also the asset keys.
export function platformKey(platform: string = process.platform, arch: string = process.arch): string {
    return `${platform}-${arch}`;
}

export function assetFor(versions: RuntimeVersions, key: string): RuntimeAsset | undefined {
    return versions.assets[key];
}

// Where an override points, if any. The setting wins over the environment variable; blank values are
// ignored so an empty setting does not shadow the variable.
export type OverrideSource = 'setting' | 'env';
export function resolveOverride(settingValue: string | undefined, envValue: string | undefined):
    { dir: string; source: OverrideSource } | undefined {
    const s = (settingValue ?? '').trim();
    if (s) { return { dir: s, source: 'setting' }; }
    const e = (envValue ?? '').trim();
    if (e) { return { dir: e, source: 'env' }; }
    return undefined;
}

// Candidate yosys executables under a runtime directory: the package layout (bin/yosys), or the
// user pointed at bin/ itself.
export function yosysCandidates(dir: string, platform: string = process.platform): string[] {
    const exe = platform === 'win32' ? 'yosys.exe' : 'yosys';
    return [`${dir}/bin/${exe}`, `${dir}/${exe}`];
}

// An archive entry we are willing to extract: relative, no `..` segments, no empty name, and a
// plain file or directory (links could point outside the install directory).
export function isSafeArchiveEntry(entryPath: string, entryType: string): boolean {
    if (entryType !== 'File' && entryType !== 'Directory') { return false; }
    if (!entryPath || entryPath.startsWith('/') || entryPath.startsWith('\\') || /^[A-Za-z]:/.test(entryPath)) { return false; }
    const segments = entryPath.split(/[\\/]+/);
    return segments.every(s => s !== '..');
}

// Parse and validate a runtime manifest. Returns the manifest, or a string describing what is wrong.
export function validateManifest(json: unknown, expected?: { version?: string; platformKey?: string }): RuntimeManifest | string {
    if (typeof json !== 'object' || json === null) { return 'runtime-manifest.json is not an object'; }
    const m = json as Record<string, unknown>;
    if (m.schema !== 1) { return `unsupported manifest schema ${String(m.schema)}`; }
    for (const k of ['version', 'os', 'arch'] as const) {
        if (typeof m[k] !== 'string' || !(m[k] as string)) { return `manifest field "${k}" missing`; }
    }
    const f = m.features as Record<string, unknown> | undefined;
    if (!f || typeof f.read_slang !== 'boolean' || typeof f.read_uhdm !== 'boolean') { return 'manifest "features" missing read_slang/read_uhdm'; }
    if (expected?.version && m.version !== expected.version) { return `manifest version ${String(m.version)} does not match expected ${expected.version}`; }
    if (expected?.platformKey && `${m.os}-${m.arch}` !== expected.platformKey) {
        return `manifest is for ${String(m.os)}-${String(m.arch)}, this host is ${expected.platformKey}`;
    }
    return json as RuntimeManifest;
}

export function installDirFor(storageRoot: string, version: string): string {
    return `${storageRoot}/${version}`;
}

export function formatBytes(n: number | undefined): string {
    if (n === undefined || !isFinite(n)) { return 'unknown size'; }
    if (n < 1024 * 1024) { return `${Math.round(n / 1024)} KB`; }
    return `${(n / (1024 * 1024)).toFixed(0)} MB`;
}

// User-facing texts (kept here so they are testable and consistent).
export function installPromptMessage(version: string, sizeHint?: string): string {
    const size = sizeHint ? ` (${sizeHint})` : '';
    return `The schematic needs the sv-pathfinder schematic runtime v${version}${size}: Yosys with the ` +
        'slang and UHDM frontends, downloaded once from the sv-pathfinder GitHub releases. Install it now?';
}
export function unsupportedPlatformMessage(key: string): string {
    return `The schematic runtime is not available for this platform (${key}). It is currently built for ` +
        'Linux x64 (AlmaLinux 8 or newer). To use another Yosys build with read_slang, set ' +
        `"sv-pathfinder.${RUNTIME_SETTING}" or ${RUNTIME_ENV_VAR} to its directory (the bin/yosys parent).`;
}
export function installDeclinedMessage(): string {
    return 'The schematic runtime is not installed. Open a schematic again to install it, or set ' +
        `"sv-pathfinder.${RUNTIME_SETTING}" to an existing runtime directory.`;
}
export function overrideInvalidMessage(dir: string, source: OverrideSource): string {
    const where = source === 'setting' ? `"sv-pathfinder.${RUNTIME_SETTING}"` : RUNTIME_ENV_VAR;
    return `${where} points at "${dir}", but no bin/yosys was found there.`;
}
