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
import { absolutizeFlist, searchDirFlags, blackboxFlags, flistWithoutUvm } from '../flist';
import { NoYosysBackendError, noBackendMessage } from './backend_policy';
import { isUvmError } from './scope_nav';
import { svLog } from '../output';

// Schematic diagnostics (the actual Yosys command we run, and any workarounds applied) go to the
// shared "sv-pathfinder" output channel, tagged [schematic].
function logSchematic(line: string) { svLog('schematic', line); }

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
    limited: boolean;  // lacks slang (yowasp) → major SystemVerilog gaps
}

let cachedBackend: Backend | null | undefined; // undefined = not probed yet
// Set by findBackend(): a plain Yosys was seen on PATH but rejected for lacking the slang frontend.
// Used to tailor the "no backend" message so the user understands why their yosys "isn't detected".
let sawYosysWithoutSlang = false;

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

// Resolve the yosys backend. Policy: prefer Yosys + the slang frontend (OSS CAD Suite path, or a PATH
// yosys that carries slang). A plain Yosys WITHOUT slang is NOT used — its Verilog-only read_verilog
// makes failures look like our bug. The sole non-slang fallback is yowasp-yosys (WASM), flagged
// `limited`.
async function findBackend(): Promise<Backend | null> {
    if (cachedBackend !== undefined) { return cachedBackend; }
    sawYosysWithoutSlang = false;
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
            cachedBackend = { name: `yosys+slang (${cmd})`, command: cmd, prelude: 'plugin -i slang; ', slang: true, limited: false };
            return cachedBackend;
        }
        // A Yosys without slang would only do limited Verilog — deliberately not used (see policy).
        sawYosysWithoutSlang = true;
    }
    // Sole non-slang fallback: yowasp-yosys CLI (pip install yowasp-yosys). Flagged limited.
    for (const cmd of ['yowasp-yosys', path.join(os.homedir(), '.local', 'bin', 'yowasp-yosys')]) {
        if (await probeCommand(cmd, ['--version'])) {
            cachedBackend = { name: `yowasp-yosys WASM (${cmd})`, command: cmd, prelude: '', slang: false, limited: true };
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
// e.g. when another extension puts a different `yosys` on PATH and it gets picked up.
export function getResolvedBackendName(): string | undefined {
    return cachedBackend ? cachedBackend.name : undefined;
}

// True when the resolved backend lacks the slang frontend (the limited yowasp fallback). The UI uses
// this to warn the user and badge the schematic so a limited render isn't mistaken for our bug.
export function isResolvedBackendLimited(): boolean {
    return !!cachedBackend && cachedBackend.limited;
}

// Build the read + elaborate + lowering script (Spike 1 presets).
function buildScript(backend: Backend, ctx: ScopeContext, preset: SchematicPreset, outJson: string, showDangling = false, extraIncludeDirs: string[] = [], shallow = false, ignoreUnknownModules = false): string {
    const files = ctx.dotF
        ? (backend.slang ? `-F ${quote(ctx.dotF)}` : ctx.fileSet.map(quote).join(' '))
        : ctx.fileSet.map(quote).join(' ');
    // Search dirs so a curated/partial filelist still elaborates: the .f's own directory + each
    // source file's directory (resolves co-located includes and sibling modules the .f omits), plus
    // any user-provided include dirs (for headers outside the source tree, e.g. vendored prim/dv).
    const searchDirs = [ctx.workDir, ...ctx.fileSet.map(f => path.dirname(f)), ...extraIncludeDirs];
    let read: string;
    let chparam = '';
    if (backend.slang) {
        // -G applies resolved instance params at elaboration; --keep-hierarchy keeps
        // children as boxes (without it yosys-slang inlines everything).
        // --ignore-timing / --ignore-initial / --ignore-assertions: delays (`a = #1 b;`), initial
        // blocks (testbench `$dumpfile`/`$dumpvars`/`$finish` and `forever` clock generators), and
        // SVA/formal statements are sim/verification-only and otherwise hard errors in slang's
        // synthesis path — drop them so a testbench top or assertion-laden RTL still yields a
        // structural view (the cells/wires are unaffected; only sim init values would be).
        // -D SYNTHESIS: let designs guard sim-only code (e.g. $dumpvars with indexed
        // selects, which slang rejects) behind `ifndef SYNTHESIS`, matching the
        // native read_verilog path below.
        const gFlags = ctx.resolvedParams.map(p => `-G ${p.name}=${p.verilogLiteral}`).join(' ');
        const search = searchDirFlags(searchDirs, true); // -I + -y (libdir) so missing modules resolve
        // shallow ("selected + 1"): blackbox the direct children so only this scope's body elaborates.
        const bb = shallow ? blackboxFlags(ctx.childModules) : '';
        // --ignore-unknown-modules: used by the UVM workaround retry so instantiations of the dropped
        // (verification) modules import as blackboxes instead of erroring as unknown modules.
        const iu = ignoreUnknownModules ? '--ignore-unknown-modules ' : '';
        read = `read_slang --keep-hierarchy --ignore-timing --ignore-initial --ignore-assertions ${iu}-D SYNTHESIS ${search} ${bb} ${gFlags} --top ${ctx.moduleName} ${files}`;
    } else {
        const search = searchDirFlags(searchDirs, false); // read_verilog: include dirs only
        read = `read_verilog -sv -DSYNTHESIS ${search} ${files}`;
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
    // $memrd/$memwr_v2 into $mem_v2 (converter requirement). Two keeps stop opt_clean from deleting
    // things a structural view must still show: module-keep preserves child INSTANCES whose outputs
    // are unused; the $mem keep preserves inferred-memory cells whose read-output is unused at this
    // elaboration (module-keep only covers instances, not $mem cells — without it, isolating a scope
    // as top silently drops memories the rest of the design reads, e.g. a RAM bank).
    // showDangling additionally keeps PUBLIC wires (all wires minus $-private) so declared-but-
    // unconnected named nets survive opt_clean for the converter to surface (see findDanglingNets).
    const keepDangling = showDangling ? 'setattr -set keep 1 w:* w:$* %d; ' : '';
    return common + `proc; memory_collect; setattr -mod -set keep 1; setattr -set keep 1 t:$mem*; ${keepDangling}opt_clean; write_json -compat-int ${quote(outJson)}`;
}

// macOS Gatekeeper quarantines OSS CAD Suite's unsigned binaries — yosys shells out to a bundled
// `realpath` while loading the slang plugin, so the schematic dies with an "Apple could not verify
// … is free of malware" dialog. Surface the one-shot fix (with the actual folder) when on macOS.
function macQuarantineHint(yosysCmd: string): string {
    if (process.platform !== 'darwin') { return ''; }
    // <ossPath>/bin/yosys -> <ossPath>; fall back to a placeholder for a bare `yosys` on PATH.
    const dir = yosysCmd.includes('/bin/') ? path.dirname(path.dirname(yosysCmd)) : '<oss-cad-suite dir>';
    return '\n\nOn macOS, OSS CAD Suite binaries may be blocked by Gatekeeper ("Apple could not verify '
        + '… is free of malware"). Clear the quarantine flag on the OSS CAD Suite folder, then reload:\n'
        + `  xattr -dr com.apple.quarantine "${dir}"`;
}

// A non-zero Yosys exit, carrying the raw output so callers can classify it (UVM / incomplete / …).
class YosysRunError extends Error {
    constructor(public readonly out: string, public readonly code: number, backendName: string) {
        super(`Yosys (${backendName}) failed with code ${code}:\n` + out.slice(-4000));
        this.name = 'YosysRunError';
    }
}

// Spawn `yosys -p <script>`; resolve its combined output, or reject (YosysRunError on non-zero exit,
// plain hinted Error on spawn failure / timeout). Logs the exact command for transparency.
function spawnYosys(backend: Backend, script: string, workDir: string): Promise<string> {
    logSchematic(`$ ${backend.command} -p '${script}'`);
    return new Promise<string>((resolve, reject) => {
        const proc = cp.spawn(backend.command, ['-p', script], { cwd: workDir });
        let out = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => out += d.toString());
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error('Yosys timed out after 120s.' + macQuarantineHint(backend.command) + '\n' + out.slice(-4000)));
        }, 120000);
        proc.on('error', err => { clearTimeout(timer); reject(new Error(`Failed to run Yosys (${backend.command}): ${err.message}` + macQuarantineHint(backend.command))); });
        proc.on('close', code => { clearTimeout(timer); if (code === 0) { resolve(out); } else { reject(new YosysRunError(out, code ?? -1, backend.name)); } });
    });
}

// Actionable hint appended to a failure message, by error class.
function hintFor(out: string, backend: Backend): string {
    if (isUvmError(out)) {
        // We retry with UVM files dropped (see runYosys); reaching here means that didn't resolve it.
        return '\n\nHint: this scope reaches UVM (uvm_pkg / uvm_macros.svh), which is testbench-only and ' +
            'not synthesizable. sv-pathfinder already retried with UVM-importing files dropped (their ' +
            'modules blackboxed); if it still fails, the UVM reference is in code that can\'t be dropped ' +
            'automatically (e.g. an RTL file that itself imports UVM). See the "sv-pathfinder" output.';
    }
    if (/No such file or directory|unknown module/.test(out)) {
        return '\n\nHint: the filelist looks incomplete. If a header (e.g. *.svh) or a module ' +
            "isn't found, add its directory to \"sv-pathfinder.schematicIncludeDirs\".";
    }
    if (/unconnected interface port|interface port on blackbox/.test(out)) {
        return '\n\nHint: this scope has a SystemVerilog interface port, so it can\'t be elaborated on its ' +
            'own. Open a parent scope that connects the interface (full mode) and navigate down to this one.';
    }
    return macQuarantineHint(backend.command);
}

export async function runYosys(ctx: ScopeContext, preset: SchematicPreset, opts?: { showDangling?: boolean; shallow?: boolean }): Promise<YosysResult> {
    const backend = await findBackend();
    if (!backend) {
        throw new NoYosysBackendError(noBackendMessage(sawYosysWithoutSlang));
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

    // Extra include directories the filelist doesn't provide (e.g. vendored prim/dv headers), for
    // curated filelists like ibex's where the assertion/coverage headers live outside the source tree.
    const extraIncludeDirs = vscode.workspace.getConfiguration('sv-pathfinder')
        .get<string[]>('schematicIncludeDirs', []);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-pathfinder-schematic-'));
    const outJson = path.join(tmpDir, 'schematic.json');

    const runOnce = (c: ScopeContext, ignoreUnknown: boolean) =>
        spawnYosys(backend, buildScript(backend, c, preset, outJson, opts?.showDangling, extraIncludeDirs, opts?.shallow, ignoreUnknown), ctx.workDir);

    let log: string;
    try {
        log = await runOnce(effectiveCtx, false);
    } catch (e) {
        // UVM WORKAROUND: UVM is testbench-only and breaks read_slang (it compiles every file in the
        // filelist). If the failure is a UVM error and we can identify the offending files, retry with
        // them commented out + --ignore-unknown-modules so their modules render as blackboxes. This is a
        // workaround, not a real elaboration — log it and tell the user what we dropped.
        const out = e instanceof YosysRunError ? e.out : '';
        let recovered: string | undefined;
        if (backend.slang && effectiveCtx.dotF && out && isUvmError(out)) {
            const filtered = await flistWithoutUvm(effectiveCtx.dotF, tmpDir, ctx.moduleName).catch(() => null);
            if (filtered) {
                logSchematic(`UVM workaround — read_slang failed on UVM; retrying with ${filtered.dropped.length} verification file(s) dropped (blackboxed). Filtered filelist: ${filtered.path}`);
                for (const f of filtered.dropped) { logSchematic(`  dropped: ${f}`); }
                // Popup ONLY when the OPENED scope's own definition was dropped — then the schematic
                // comes back empty/blackboxed and the user needs to know why. Dropping a DEEPER
                // verification module renders fine, so a popup every time would just be noise (logged).
                if (filtered.topDropped) {
                    vscode.window.showWarningMessage(
                        `Schematic: "${ctx.moduleName}" can't be rendered — its source imports UVM (testbench-only, ` +
                        'not synthesizable), so it appears as an empty blackbox. See the "sv-pathfinder" output for details.');
                }
                try {
                    recovered = await runOnce({ ...effectiveCtx, dotF: filtered.path }, true);
                } catch (e2) {
                    throw e2 instanceof YosysRunError ? new Error(e2.message + hintFor(e2.out, backend)) : e2;
                }
            }
        }
        if (recovered === undefined) {
            throw e instanceof YosysRunError ? new Error(e.message + hintFor(out, backend)) : e;
        }
        log = recovered;
    }

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
