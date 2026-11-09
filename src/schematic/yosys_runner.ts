// C2 — Yosys runner on the managed schematic runtime (Yosys with read_slang built in, plus the
// uhdm2rtlil plugin for read_uhdm), run as a subprocess. See runtime_manager.ts for how the runtime
// is resolved/installed. Script presets validated by Spike 1 (docs/spikes/rtl-structural/).
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ScopeContext } from './scope_resolver';
import { absolutizeFlist, searchDirFlags, blackboxFlags, flistWithoutUvm } from '../flist';
import { NoYosysBackendError, uhdmFrontendUnavailableMessage, yosysExitMessage } from './backend_policy';
import { isUvmError, isKeptBoundaryError } from './scope_nav';
import { svLog } from '../output';
import { ensureRuntime, resetRuntimeCache, resolvedRuntimeName, ResolvedRuntime } from './runtime_manager';
import { UHDM_PLUGIN } from './runtime_policy';

// Schematic diagnostics (the actual Yosys command we run, and any workarounds applied) go to the
// shared "sv-pathfinder" output channel, tagged [schematic].
function logSchematic(line: string) { svLog('schematic', line); }

export type SchematicPreset = 'rtl' | 'gls';

export interface YosysResult {
    yosysJson: any;
    backend: string;   // for diagnostics / breadcrumb
    log: string;
}

// The runtime the schematic runs on; `plugin` is set when the script needs `yosys -m uhdm2rtlil`.
interface Backend {
    name: string;
    command: string;
    readUhdm: boolean; // the uhdm2rtlil plugin is available (Linux x64 managed runtime)
}

function toBackend(rt: ResolvedRuntime): Backend {
    return { name: rt.name, command: rt.yosys, readUhdm: rt.features.read_uhdm };
}

function quote(p: string): string {
    return p.includes(' ') ? `"${p}"` : p;
}

export function resetBackendCache(): void {
    resetRuntimeCache();
}

// The runtime that was actually resolved (version + where it came from). Surfaced to the webview so
// a render failure can name the toolchain that produced the netlist.
export function getResolvedBackendName(): string | undefined {
    return resolvedRuntimeName();
}

// Build the read + elaborate + lowering script (Spike 1 presets).
function buildScript(ctx: ScopeContext, preset: SchematicPreset, outJson: string, showDangling = false, extraIncludeDirs: string[] = [], shallow = false, ignoreUnknownModules = false, bestEffortHierarchy = false): string {
    const files = ctx.dotF ? `-F ${quote(ctx.dotF)}` : ctx.fileSet.map(quote).join(' ');
    // Search dirs so a curated/partial filelist still elaborates: the .f's own directory + each
    // source file's directory (resolves co-located includes and sibling modules the .f omits), plus
    // any user-provided include dirs (for headers outside the source tree, e.g. vendored prim/dv).
    const searchDirs = [ctx.workDir, ...ctx.fileSet.map(f => path.dirname(f)), ...extraIncludeDirs, ...(ctx.extraIncludeDirs ?? [])];
    let read: string;
    if (ctx.uhdmFile) {
        // Direct .uhdm design: import the elaborated UHDM as it is. Parameters, defines and includes
        // were resolved by Surelog before serialization, so no -G/-D/-I; every parameterization is
        // already a separate module in the import (Yosys-style $paramod names), so no chparam either.
        read = `read_uhdm ${quote(ctx.uhdmFile)}`;
    } else {
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
        // Instance params first; a Surelog -P override (recovered from the .uhdm's log) only when the
        // instance did not already pin that parameter.
        const pinned = new Set(ctx.resolvedParams.map(p => p.name));
        const gFlags = [...ctx.resolvedParams, ...(ctx.extraParams ?? []).filter(p => !pinned.has(p.name))]
            .map(p => `-G ${p.name}=${p.verilogLiteral}`).join(' ');
        // +define+s the .uhdm was built with, so `ifdef-guarded code takes the same branches.
        const dFlags = (ctx.extraDefines ?? []).map(d => `-D ${d}`).join(' ');
        const search = searchDirFlags(searchDirs, true); // -I + -y (libdir) so missing modules resolve
        // shallow ("selected + 1"): blackbox the direct children so only this scope's body elaborates.
        const bb = shallow ? blackboxFlags(ctx.childModules) : '';
        // --ignore-unknown-modules: used by the UVM workaround retry so instantiations of the dropped
        // (verification) modules import as blackboxes instead of erroring as unknown modules.
        const iu = ignoreUnknownModules ? '--ignore-unknown-modules ' : '';
        // --allow-use-before-declare / --allow-hierarchical-const: slang compat relaxations for
        // LRM-strict rejections that simulators tolerate (package localparams referenced before
        // their declaration; $bits() on interface members — both hit by real designs, e.g. Vortex).
        // They only make slang ACCEPT more code — the netlist of already-valid code is unchanged —
        // and the schematic is a viewer, not a linter: by the time it runs, the design already
        // loaded for navigation, so failing here on stylistic strictness helps no one.
        //
        // Hierarchy mode: --keep-hierarchy first (every child stays a box). When a module's
        // interface port has no modport, keep REFUSES its boundary ("interface port on kept module
        // boundary must be a modport") and the whole read fails; the runYosys fallback retries with
        // --best-effort-hierarchy, which keeps every other boundary and inlines only those modules
        // (measured on Vortex: 2 of ~180 dissolve; where keep succeeds the output is identical).
        const hier = bestEffortHierarchy ? '--best-effort-hierarchy' : '--keep-hierarchy';
        read = `read_slang ${hier} --ignore-timing --ignore-initial --ignore-assertions --allow-use-before-declare --allow-hierarchical-const ${iu}-D SYNTHESIS ${dFlags} ${search} ${bb} ${gFlags} --top ${ctx.moduleName} ${files}`;
    }
    // read_uhdm imports $display/$finish and assertions as $print/$check cells, which the converter
    // does not draw (read_slang drops them via --ignore-initial/--ignore-assertions). Delete them
    // right after import; the selection is a no-op when none exist.
    const simOnly = ctx.uhdmFile ? 'delete t:$print t:$check t:$assert t:$assume t:$cover t:$live t:$fair; ' : '';
    const common = `${read}; hierarchy -top ${ctx.moduleName}; ${simOnly}`;
    if (preset === 'gls') {
        // Gate-level view: synth flow. -noabc: the managed runtime's Yosys is built without ABC
        // (nothing in the schematic needs it); techmap'd $_AND_/$_OR_/... cells are gate-level and
        // converter-supported.
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

// One warning per design per session when the best-effort hierarchy fallback kicks in, so the
// user knows why some instances appear flattened (not boxes) without being nagged on every
// render of that design. Reset only on window reload (module state), like the backend cache.
const bestEffortWarnedDesigns = new Set<string>();
function maybeWarnBestEffort(ctx: ScopeContext): void {
    const designKey = ctx.dotF ?? ctx.fileSet[0] ?? ctx.moduleName;
    if (bestEffortWarnedDesigns.has(designKey)) { return; }
    bestEffortWarnedDesigns.add(designKey);
    vscode.window.showWarningMessage(
        'Schematic: some modules in this design have interface ports without modports, which ' +
        "can't be kept as child boxes — those instances were flattened into their parent " +
        '(best-effort hierarchy). Everything else renders normally; see the "sv-pathfinder" ' +
        'output for details.');
}

// macOS Gatekeeper quarantines downloaded unsigned binaries, so a runtime the user pointed at by hand
// can die with an "Apple could not verify … is free of malware" dialog. Surface the one-shot fix
// (with the actual folder) when on macOS.
function macQuarantineHint(yosysCmd: string): string {
    if (process.platform !== 'darwin') { return ''; }
    const dir = yosysCmd.includes('/bin/') ? path.dirname(path.dirname(yosysCmd)) : '<runtime dir>';
    return '\n\nOn macOS, downloaded binaries may be blocked by Gatekeeper ("Apple could not verify '
        + '… is free of malware"). Clear the quarantine flag on the runtime folder, then reload:\n'
        + `  xattr -dr com.apple.quarantine "${dir}"`;
}

// A non-zero Yosys exit or a signal death, carrying the raw output so callers can classify it
// (UVM / incomplete / …).
class YosysRunError extends Error {
    constructor(public readonly out: string, public readonly code: number, backendName: string, signal: string | null = null, usingUhdm = false) {
        super(yosysExitMessage(backendName, code, signal, usingUhdm) + '\n' + out.slice(-4000));
        this.name = 'YosysRunError';
    }
}

// Spawn `yosys [-m uhdm2rtlil] -p <script>`; resolve its combined output, or reject (YosysRunError on
// non-zero exit, plain hinted Error on spawn failure / timeout). Logs the exact command for transparency.
function spawnYosys(backend: Backend, script: string, workDir: string, plugin: boolean): Promise<string> {
    const args = plugin ? ['-m', UHDM_PLUGIN, '-p', script] : ['-p', script];
    logSchematic(`$ ${backend.command} ${args.slice(0, -1).join(' ')} '${script}'`);
    return new Promise<string>((resolve, reject) => {
        const proc = cp.spawn(backend.command, args, { cwd: workDir });
        let out = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => out += d.toString());
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error('Yosys timed out after 120s.' + macQuarantineHint(backend.command) + '\n' + out.slice(-4000)));
        }, 120000);
        proc.on('error', err => { clearTimeout(timer); reject(new Error(`Failed to run Yosys (${backend.command}): ${err.message}` + macQuarantineHint(backend.command))); });
        proc.on('close', (code, signal) => { clearTimeout(timer); if (code === 0) { resolve(out); } else { reject(new YosysRunError(out, code ?? -1, backend.name, signal, plugin)); } });
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
    if (out.includes('is not a valid top-level module')) {
        return '\n\nHint: Yosys schematics must be rooted at a module. The selected scope is likely a ' +
            'SystemVerilog interface, program, or checker; select a module instance that contains or ' +
            'connects it instead.';
    }
    return macQuarantineHint(backend.command);
}

export async function runYosys(ctx: ScopeContext, preset: SchematicPreset, opts?: { showDangling?: boolean; shallow?: boolean }): Promise<YosysResult> {
    // Resolves the override or the managed install; on first use this is where the one-time download
    // prompt appears. Throws NoYosysBackendError (typed, so the view can offer actions) when declined.
    const backend = toBackend(await ensureRuntime({ interactive: true }));
    const useUhdm = !!ctx.uhdmFile;
    if (useUhdm && !backend.readUhdm) {
        throw new NoYosysBackendError(uhdmFrontendUnavailableMessage(backend.name));
    }

    // read_slang resolves relative .f entries (and nested -f/-F/-C includes)
    // against the yosys CWD, not each command file's own directory, so nested or
    // workDir-relative paths fail to load. Rewrite the .f (recursively) with
    // absolute paths first; absolute paths resolve regardless of CWD.
    let effectiveCtx = ctx;
    if (ctx.dotF) {
        effectiveCtx = { ...ctx, dotF: await absolutizeFlist(ctx.dotF) };
    }

    // Extra include directories the filelist doesn't provide (e.g. vendored prim/dv headers), for
    // curated filelists like ibex's where the assertion/coverage headers live outside the source tree.
    const extraIncludeDirs = vscode.workspace.getConfiguration('sv-pathfinder')
        .get<string[]>('schematicIncludeDirs', []);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-pathfinder-schematic-'));
    const outJson = path.join(tmpDir, 'schematic.json');

    // An explicit file set (a .uhdm design re-parsed from its sources) goes through a generated
    // filelist, not the command line: Yosys cuts a script command at a few KB and reports
    // "Bad command", which a 100+ file design exceeds (HummingbirdV2 E203: 16 KB of paths).
    if (!useUhdm && !effectiveCtx.dotF && effectiveCtx.fileSet.length > 0) {
        const generated = path.join(tmpDir, 'sources.f');
        await fs.writeFile(generated, effectiveCtx.fileSet.join('\n') + '\n');
        effectiveCtx = { ...effectiveCtx, dotF: generated };
    }

    const runOnce = (c: ScopeContext, ignoreUnknown: boolean, bestEffort = false) =>
        spawnYosys(backend, buildScript(c, preset, outJson, opts?.showDangling, extraIncludeDirs, opts?.shallow, ignoreUnknown, bestEffort), ctx.workDir, useUhdm);

    // HIERARCHY FALLBACK: --keep-hierarchy refuses any module whose interface port lacks a modport
    // (e.g. Vortex's VX_execute), failing the whole read. Retry with --best-effort-hierarchy — it
    // keeps every other boundary and inlines only the offending modules (identical output where
    // keep succeeds) — and tell the user once per design why some instances aren't boxes.
    const run = async (c: ScopeContext, ignoreUnknown: boolean): Promise<string> => {
        try {
            return await runOnce(c, ignoreUnknown);
        } catch (e) {
            if (useUhdm || !(e instanceof YosysRunError) || !isKeptBoundaryError(e.out)) { throw e; }
            logSchematic('--keep-hierarchy refused a module boundary (interface port without a ' +
                'modport); retrying with --best-effort-hierarchy (the offending instances are ' +
                'flattened into their parent).');
            const recovered = await runOnce(c, ignoreUnknown, true);
            maybeWarnBestEffort(ctx);
            return recovered;
        }
    };

    let log: string;
    try {
        log = await run(effectiveCtx, false);
    } catch (e) {
        // UVM WORKAROUND: UVM is testbench-only and breaks read_slang (it compiles every file in the
        // filelist). If the failure is a UVM error and we can identify the offending files, retry with
        // them commented out + --ignore-unknown-modules so their modules render as blackboxes. This is a
        // workaround, not a real elaboration — log it and tell the user what we dropped.
        const out = e instanceof YosysRunError ? e.out : '';
        let recovered: string | undefined;
        if (effectiveCtx.dotF && out && isUvmError(out)) {
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
                    recovered = await run({ ...effectiveCtx, dotF: filtered.path }, true);
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
