// Managed schematic runtime: resolve (override or installed), or download + verify + extract +
// self-test + install the pinned release asset on first use. Policy and texts are in
// runtime_policy.ts, the install pipeline in runtime_install.ts; this file holds the VS Code glue.
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { svLog } from '../output';
import { NoYosysBackendError } from './backend_policy';
import {
    RuntimeAsset, RuntimeFeatures, RuntimeManifest, RuntimeVersions, RUNTIME_ENV_VAR, RUNTIME_SETTING, UHDM_PLUGIN,
    assetFor, installDeclinedMessage, installDirFor, installPromptMessage,
    overrideInvalidMessage, platformKey, resolveOverride, unsupportedPlatformMessage, validateManifest, yosysCandidates,
} from './runtime_policy';
import { installFromSource, removeOtherVersions } from './runtime_install';

// Bundled by esbuild at build time: the pins of toolchain/versions.json become part of dist/extension.js.
const VERSIONS: RuntimeVersions = require('../../toolchain/versions.json');

export interface ResolvedRuntime {
    dir: string;
    yosys: string;               // absolute path of the executable
    source: 'setting' | 'env' | 'managed';
    version?: string;            // from runtime-manifest.json when present
    features: RuntimeFeatures;
    name: string;                // for diagnostics / the webview breadcrumb
}

let storageRoot: string | undefined;
let cached: ResolvedRuntime | undefined;
let installInFlight: Promise<ResolvedRuntime> | undefined;

function log(line: string) { svLog('schematic', line); }

export function initSchematicRuntime(context: vscode.ExtensionContext): void {
    storageRoot = path.join(context.globalStorageUri.fsPath, 'schematic-runtime');
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`sv-pathfinder.${RUNTIME_SETTING}`)) { resetRuntimeCache(); }
    }));
}

export function resetRuntimeCache(): void { cached = undefined; }
export function resolvedRuntimeName(): string | undefined { return cached?.name; }
export function pinnedRuntimeVersion(): string { return VERSIONS.runtimeVersion; }

async function exists(p: string): Promise<boolean> {
    try { await fsp.access(p); return true; } catch { return false; }
}

async function readManifest(dir: string): Promise<RuntimeManifest | undefined> {
    try {
        const m = validateManifest(JSON.parse(await fsp.readFile(path.join(dir, 'runtime-manifest.json'), 'utf8')));
        return typeof m === 'string' ? undefined : m;
    } catch { return undefined; }
}

// Describe a runtime directory that is already on disk (override or managed install).
async function describe(dir: string, source: ResolvedRuntime['source']): Promise<ResolvedRuntime | undefined> {
    let yosys: string | undefined;
    for (const c of yosysCandidates(dir)) { if (await exists(c)) { yosys = c; break; } }
    if (!yosys) { return undefined; }
    const manifest = await readManifest(dir);
    const pluginPresent = await exists(path.join(dir, 'share', 'yosys', 'plugins', `${UHDM_PLUGIN}.so`));
    const features: RuntimeFeatures = manifest?.features ?? { read_slang: true, read_uhdm: pluginPresent };
    const version = manifest?.version;
    return { dir, yosys, source, version, features, name: `schematic runtime${version ? ' v' + version : ''} (${source}: ${dir})` };
}

// Resolve the runtime: setting, then environment variable, then the managed install. When nothing is
// installed and `interactive` is set, offer the one-time download. Throws NoYosysBackendError with a
// user-facing message when there is no runtime to use.
export async function ensureRuntime(opts: { interactive: boolean }): Promise<ResolvedRuntime> {
    if (cached) { return cached; }
    const setting = vscode.workspace.getConfiguration('sv-pathfinder').get<string>(RUNTIME_SETTING, '');
    const override = resolveOverride(setting, process.env[RUNTIME_ENV_VAR]);
    if (override) {
        const rt = await describe(override.dir, override.source);
        if (!rt) { throw new NoYosysBackendError(overrideInvalidMessage(override.dir, override.source)); }
        cached = rt;
        log(`runtime: ${rt.name}`);
        return rt;
    }
    if (!storageRoot) { throw new NoYosysBackendError('The schematic runtime manager was not initialized.'); }
    const installDir = installDirFor(storageRoot, VERSIONS.runtimeVersion);
    const installed = await describe(installDir, 'managed');
    if (installed) {
        cached = installed;
        log(`runtime: ${installed.name}`);
        return installed;
    }
    const key = platformKey();
    const asset = assetFor(VERSIONS, key);
    if (!asset) { throw new NoYosysBackendError(unsupportedPlatformMessage(key)); }
    if (!opts.interactive) { throw new NoYosysBackendError(installDeclinedMessage()); }
    if (installInFlight) { return installInFlight; }
    installInFlight = promptAndInstall(asset, installDir).finally(() => { installInFlight = undefined; });
    return installInFlight;
}

async function promptAndInstall(asset: RuntimeAsset, installDir: string): Promise<ResolvedRuntime> {
    const install = 'Install';
    const releases = 'Open Releases Page';
    const pick = await vscode.window.showInformationMessage(installPromptMessage(VERSIONS.runtimeVersion), install, releases);
    if (pick === releases) {
        vscode.env.openExternal(vscode.Uri.parse(asset.url.replace(/\/download\/.*$/, '')));
        throw new NoYosysBackendError(installDeclinedMessage());
    }
    if (pick !== install) { throw new NoYosysBackendError(installDeclinedMessage()); }
    const rt = await installRuntime(asset, installDir);
    cached = rt;
    vscode.window.showInformationMessage(`sv-pathfinder: schematic runtime v${VERSIONS.runtimeVersion} installed.`);
    return rt;
}

// Download, verify, extract, self-test, then move into place atomically (runtime_install.ts does the
// work); here only the progress UI and the user-facing error.
export async function installRuntime(asset: RuntimeAsset, installDir: string): Promise<ResolvedRuntime> {
    try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'sv-pathfinder: installing the schematic runtime', cancellable: false },
            progress => installFromSource(asset, installDir, { version: VERSIONS.runtimeVersion, platformKey: platformKey() }, {
                progress: message => progress.report({ message }),
                log,
            }));
        await removeOtherVersions(path.dirname(installDir), path.basename(installDir));
        const rt = await describe(installDir, 'managed');
        if (!rt) { throw new Error('installed runtime has no bin/yosys'); }
        log(`runtime: installed ${rt.name}`);
        return rt;
    } catch (e: any) {
        log(`runtime: install failed: ${e?.message ?? e}`);
        throw new NoYosysBackendError(`Installing the schematic runtime failed: ${e?.message ?? e}. ` +
            'Open a schematic again to retry, or download the archive by hand and point ' +
            `"sv-pathfinder.${RUNTIME_SETTING}" at the extracted directory.`);
    }
}

// Command "Install Schematic Runtime": re-run the install even when one exists (repair).
export async function reinstallRuntimeCommand(): Promise<void> {
    if (!storageRoot) { return; }
    const key = platformKey();
    const asset = assetFor(VERSIONS, key);
    if (!asset) { vscode.window.showErrorMessage(unsupportedPlatformMessage(key)); return; }
    resetRuntimeCache();
    try {
        const rt = await installRuntime(asset, installDirFor(storageRoot, VERSIONS.runtimeVersion));
        cached = rt;
        vscode.window.showInformationMessage(`sv-pathfinder: schematic runtime v${VERSIONS.runtimeVersion} installed at ${rt.dir}.`);
    } catch (e: any) {
        vscode.window.showErrorMessage(`sv-pathfinder: ${e?.message ?? e}`);
    }
}
