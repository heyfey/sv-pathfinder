// vscode-free install pipeline for the managed schematic runtime: download → SHA-256 → extract (safe
// entries only) → validate manifest → self-test (a real read_slang run) → atomic move into place. runtime_manager.ts wraps it
// with the VS Code prompt and progress UI; runtime_install.test.ts exercises it against a fake package
// served over local HTTP.
import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import * as tar from 'tar';
import { RuntimeManifest, isSafeArchiveEntry, validateManifest, yosysArgs, yosysCandidates, yosysPath } from './runtime_policy';

export interface InstallSource {
    url: string;
    sha256: string;            // '' = not pinned (logged, not verified)
}
export interface InstallExpectation {
    version: string;
    platformKey: string;
}
export interface InstallCallbacks {
    progress?: (message: string) => void;
    log?: (line: string) => void;
    // Overridable for tests (the real one spawns bin/yosys).
    selfTest?: (dir: string, manifest: RuntimeManifest) => Promise<void>;
}

// Stream the asset to disk while hashing it. Follows redirects (GitHub release assets redirect to a
// CDN host). Returns the hex SHA-256.
export async function downloadToFile(url: string, dest: string, onProgress?: (done: number, total?: number) => void): Promise<string> {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) { throw new Error(`download failed: HTTP ${res.status} ${res.statusText} for ${url}`); }
    const total = Number(res.headers.get('content-length')) || undefined;
    const hash = crypto.createHash('sha256');
    let done = 0, lastReport = 0;
    const body = Readable.fromWeb(res.body as any);
    body.on('data', (chunk: Buffer) => {
        hash.update(chunk);
        done += chunk.length;
        if (onProgress && done - lastReport > 2 * 1024 * 1024) { lastReport = done; onProgress(done, total); }
    });
    await pipeline(body, fs.createWriteStream(dest));
    onProgress?.(done, total);
    return hash.digest('hex');
}

// Extract the archive's single top-level directory into `dest`, skipping anything that is not a plain
// file/directory with a relative, traversal-free path.
export async function extractArchive(file: string, dest: string): Promise<void> {
    await fsp.mkdir(dest, { recursive: true });
    await tar.x({
        file, cwd: dest, strip: 1,
        filter: (p, entry) => isSafeArchiveEntry(p, String((entry as tar.ReadEntry).type ?? 'File')),
    });
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
    return new Promise(resolve => {
        const proc = cp.spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => out += d.toString());
        proc.on('error', err => resolve({ code: -1, out: err.message }));
        proc.on('close', code => resolve({ code: code ?? -1, out }));
    });
}

// The package must actually work on this machine before it is called installed. `help <cmd>` is not
// a test (Yosys exits 0 for an unknown command), so read_slang elaborates a one-gate module and the
// result must come back through write_json; read_uhdm is checked by loading its plugin and asking
// for its help text, which only exists when the plugin registered the command.
export async function selfTestRuntime(dir: string, manifest: RuntimeManifest): Promise<void> {
    const yosys = yosysCandidates(dir)[0];
    await fsp.chmod(yosys, 0o755).catch(() => { });
    const preload = manifest.preload ?? [];
    const probe = path.join(dir, 'selftest');
    await fsp.mkdir(probe, { recursive: true });
    try {
        const sv = path.join(probe, 't.sv'), json = path.join(probe, 't.json');
        await fsp.writeFile(sv, 'module t(input a, b, output y); assign y = a & b; endmodule\n');
        const script = `read_slang ${yosysPath(sv)} --top t; hierarchy -top t; proc; write_json ${yosysPath(json)}`;
        let r = await run(yosys, yosysArgs(preload, false, script), dir);
        const modules = r.code === 0 ? await fsp.readFile(json, 'utf8').then(t => Object.keys(JSON.parse(t).modules ?? {})).catch(() => []) : [];
        if (r.code !== 0 || !modules.includes('t')) {
            throw new Error(`self-test "read_slang" failed (exit ${r.code}): ${lastLines(r.out)}`);
        }
        if (manifest.features.read_uhdm) {
            r = await run(yosys, yosysArgs(preload, true, 'help read_uhdm'), dir);
            if (r.code !== 0 || !/read_uhdm/.test(r.out) || /No such command/i.test(r.out)) {
                throw new Error(`self-test "read_uhdm" failed (exit ${r.code}): ${lastLines(r.out)}`);
            }
        }
    } finally {
        await fsp.rm(probe, { recursive: true, force: true }).catch(() => { });
    }
}

function lastLines(out: string): string { return out.trim().split('\n').slice(-3).join(' | '); }

export function formatBytesShort(n: number | undefined): string {
    if (n === undefined || !isFinite(n)) { return '?'; }
    return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(0)} MB`;
}

// Install `source` into `installDir` (replacing what is there). On any failure the temporary
// directory is removed and the error is rethrown; `installDir` is only touched after everything passed.
export async function installFromSource(source: InstallSource, installDir: string, expected: InstallExpectation, cb: InstallCallbacks = {}): Promise<RuntimeManifest> {
    const root = path.dirname(installDir);
    await fsp.mkdir(root, { recursive: true });
    const tmp = await fsp.mkdtemp(path.join(root, 'tmp-'));
    const archive = path.join(tmp, 'runtime.tar.gz');
    const stage = path.join(tmp, 'stage');
    try {
        cb.progress?.('downloading…');
        cb.log?.(`runtime: downloading ${source.url}`);
        const digest = await downloadToFile(source.url, archive, (done, total) =>
            cb.progress?.(`downloading… ${formatBytesShort(done)}${total ? ' / ' + formatBytesShort(total) : ''}`));
        if (source.sha256 && digest !== source.sha256) {
            throw new Error(`SHA-256 mismatch: downloaded ${digest}, expected ${source.sha256}`);
        }
        if (!source.sha256) { cb.log?.('runtime: WARNING no sha256 pinned for this asset; skipping verification'); }
        cb.progress?.('extracting…');
        await extractArchive(archive, stage);
        cb.progress?.('checking…');
        const manifestJson = JSON.parse(await fsp.readFile(path.join(stage, 'runtime-manifest.json'), 'utf8'));
        const manifest = validateManifest(manifestJson, expected);
        if (typeof manifest === 'string') { throw new Error(manifest); }
        await (cb.selfTest ?? selfTestRuntime)(stage, manifest);
        await fsp.rm(installDir, { recursive: true, force: true });
        await fsp.rename(stage, installDir);
        await fsp.rm(tmp, { recursive: true, force: true });
        return manifest;
    } catch (e) {
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => { });
        throw e;
    }
}

// Drop sibling versions after a successful install (one runtime per extension version is enough).
export async function removeOtherVersions(root: string, keep: string): Promise<void> {
    const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
        if (e.isDirectory() && e.name !== keep) {
            await fsp.rm(path.join(root, e.name), { recursive: true, force: true }).catch(() => { });
        }
    }
}
