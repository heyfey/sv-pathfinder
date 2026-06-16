// C2 — Yosys runner with a configurable backend.
// PRIMARY:  native Yosys + read_slang (OSS CAD Suite), run as a subprocess.
// FALLBACK: native Yosys without the slang plugin (read_verilog), then
//           yowasp-yosys (WASM, pip-installed CLI) with read_verilog.
// Script presets validated by Spike 1 (docs/spikes/rtl-structural/).
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ScopeContext } from './scope_resolver';
import { absolutizeFlist } from '../flist';

export type SchematicPreset = 'rtl' | 'gls';

export interface YosysResult {
    yosysJson: any;
    backend: string;   // for diagnostics / breadcrumb
    log: string;
}

interface Backend {
    name: string;
    command: string;
    prelude: string;   // e.g. "plugin -i slang; "
    slang: boolean;    // read_slang available?
}

let cachedBackend: Backend | null | undefined; // undefined = not probed yet

function quote(p: string): string {
    return p.includes(' ') ? `"${p}"` : p;
}

async function probeCommand(cmd: string, args: string[]): Promise<boolean> {
    return new Promise(resolve => {
        try {
            const proc = cp.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            proc.stdout.on('data', d => out += d.toString());
            proc.stderr.on('data', d => out += d.toString());
            proc.on('error', () => resolve(false));
            proc.on('close', code => resolve(code === 0));
        } catch {
            resolve(false);
        }
    });
}

// Resolve the yosys binary: explicit setting > OSS CAD Suite path setting > PATH.
async function findBackend(): Promise<Backend | null> {
    if (cachedBackend !== undefined) { return cachedBackend; }
    const config = vscode.workspace.getConfiguration('sv-pathfinder');
    const candidates: string[] = [];
    const ossPath = config.get<string>('ossCadSuitePath', '');
    if (ossPath) {
        candidates.push(path.join(ossPath, 'bin', 'yosys'));
        candidates.push(path.join(ossPath, 'yosys')); // user pointed at bin/ directly
    }
    candidates.push('yosys');

    for (const cmd of candidates) {
        if (!await probeCommand(cmd, ['--version'])) { continue; }
        // slang.so ships in OSS CAD Suite but is NOT auto-registered (Spike 1)
        if (await probeCommand(cmd, ['-p', 'plugin -i slang'])) {
            cachedBackend = { name: `yosys+slang (${cmd})`, command: cmd, prelude: 'plugin -i slang; ', slang: true };
            return cachedBackend;
        }
        cachedBackend = { name: `yosys native (${cmd})`, command: cmd, prelude: '', slang: false };
        return cachedBackend;
    }
    // WASM fallback: yowasp-yosys CLI (pip install yowasp-yosys); native frontend only
    for (const cmd of ['yowasp-yosys', path.join(os.homedir(), '.local', 'bin', 'yowasp-yosys')]) {
        if (await probeCommand(cmd, ['--version'])) {
            cachedBackend = { name: `yowasp-yosys WASM (${cmd})`, command: cmd, prelude: '', slang: false };
            return cachedBackend;
        }
    }
    cachedBackend = null;
    return null;
}

export function resetBackendCache(): void {
    cachedBackend = undefined;
}

// The yosys backend that was actually resolved (name includes the binary path and slang/native).
// Surfaced to the webview so a render failure can name the toolchain that produced the netlist —
// e.g. when another extension (TerosHDL) puts a different `yosys` on PATH and it gets picked up.
export function getResolvedBackendName(): string | undefined {
    return cachedBackend ? cachedBackend.name : undefined;
}

// Build the read + elaborate + lowering script (Spike 1 presets).
function buildScript(backend: Backend, ctx: ScopeContext, preset: SchematicPreset, outJson: string): string {
    const files = ctx.dotF
        ? (backend.slang ? `-F ${quote(ctx.dotF)}` : ctx.fileSet.map(quote).join(' '))
        : ctx.fileSet.map(quote).join(' ');
    let read: string;
    let chparam = '';
    if (backend.slang) {
        // -G applies resolved instance params at elaboration; --keep-hierarchy keeps
        // children as boxes (without it yosys-slang inlines everything).
        // --ignore-timing: delays (`a = #1 b;`) are sim-only and otherwise hard errors
        // in slang's synthesis path — common in legacy RTL; irrelevant to structure.
        // -D SYNTHESIS: let designs guard sim-only code (e.g. $dumpvars with indexed
        // selects, which slang rejects) behind `ifndef SYNTHESIS`, matching the
        // native read_verilog path below.
        const gFlags = ctx.resolvedParams.map(p => `-G ${p.name}=${p.verilogLiteral}`).join(' ');
        read = `read_slang --keep-hierarchy --ignore-timing -D SYNTHESIS ${gFlags} --top ${ctx.moduleName} ${files}`;
    } else {
        read = `read_verilog -sv -DSYNTHESIS ${files}`;
        chparam = ctx.resolvedParams.map(p => ` -chparam ${p.name} ${p.verilogLiteral}`).join('');
    }
    const common = `${backend.prelude}${read}; hierarchy -top ${ctx.moduleName}${chparam}; `;
    if (preset === 'gls') {
        // Gate-level view: synth flow. -noabc because OSS CAD Suite's yosys resolves its
        // bundled abc via a path that breaks when yosys is invoked directly (not via the
        // env script); techmap'd $_AND_/$_OR_/... cells are gate-level and converter-supported.
        return common + `synth -top ${ctx.moduleName} -noabc; opt_clean; write_json -compat-int ${quote(outJson)}`;
    }
    // RTL-structural (validated): proc -> coarse cells; memory_collect merges
    // $memrd/$memwr_v2 into $mem_v2 (converter requirement); module-keep stops
    // opt_clean from deleting child instances whose outputs are unused.
    return common + `proc; memory_collect; setattr -mod -set keep 1; opt_clean; write_json -compat-int ${quote(outJson)}`;
}

export async function runYosys(ctx: ScopeContext, preset: SchematicPreset): Promise<YosysResult> {
    const backend = await findBackend();
    if (!backend) {
        throw new Error(
            'No Yosys found. Install OSS CAD Suite (bundles Yosys + the slang frontend) and set ' +
            '"sv-pathfinder.ossCadSuitePath", or put yosys on PATH, or `pip install yowasp-yosys`.');
    }
    if (!backend.slang && ctx.dotF) {
        // native read_verilog can't consume .f command files; warn but try the raw file list
        if (ctx.fileSet.length === 0) {
            throw new Error(
                `The ${backend.name} backend cannot read .f filelists (read_slang required). ` +
                'Install OSS CAD Suite for full SystemVerilog support.');
        }
    }

    // read_slang resolves relative .f entries (and nested -f/-F/-C includes)
    // against the yosys CWD, not each command file's own directory, so nested or
    // workDir-relative paths fail to load. Rewrite the .f (recursively) with
    // absolute paths first; absolute paths resolve regardless of CWD.
    let effectiveCtx = ctx;
    if (backend.slang && ctx.dotF) {
        effectiveCtx = { ...ctx, dotF: await absolutizeFlist(ctx.dotF) };
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-pathfinder-schematic-'));
    const outJson = path.join(tmpDir, 'schematic.json');
    const script = buildScript(backend, effectiveCtx, preset, outJson);

    const log = await new Promise<string>((resolve, reject) => {
        const proc = cp.spawn(backend.command, ['-p', script], { cwd: ctx.workDir });
        let out = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => out += d.toString());
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error('Yosys timed out after 120s.\n' + out.slice(-4000)));
        }, 120000);
        proc.on('error', err => { clearTimeout(timer); reject(err); });
        proc.on('close', code => {
            clearTimeout(timer);
            if (code === 0) { resolve(out); }
            else { reject(new Error(`Yosys (${backend.name}) failed with code ${code}:\n` + out.slice(-4000))); }
        });
    });

    try {
        const yosysJson = JSON.parse(await fs.readFile(outJson, 'utf8'));
        return { yosysJson, backend: backend.name, log };
    } finally {
        // Debugging aid: set SV_PATHFINDER_KEEP_SCHEMATIC_JSON to keep the generated Yosys JSON
        // (e.g. to inspect why a cell/instance isn't rendering) instead of deleting the temp dir.
        if (process.env.SV_PATHFINDER_KEEP_SCHEMATIC_JSON) {
            console.warn(`sv-pathfinder schematic: kept generated Yosys JSON at ${outJson}`);
        } else {
            fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
        }
    }
}
