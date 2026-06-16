// C3 — Converter: Yosys JSON -> DigitalJS JSON via the published yosys2digitaljs.
// Spike 1 found no cell-coverage patches needed for the validated script presets;
// unknown $-cells throw, so surface a useful error instead of a stack trace.
const { yosys2digitaljs } = require('yosys2digitaljs/core');

// yosys2digitaljs supports only input/output ports and single-driver nets, and
// digitaljs has no bidirectional-port modeling. Legacy RTL with inout buses
// (`inout [7:0] data`) is common, so instead of failing, render inouts as plain
// connection points: a module-level inout becomes an output-style port box (net
// SINK), and a cell-level inout pin is treated as an input from the parent's
// perspective (also a sink). Neither adds a net source, so the transform cannot
// introduce the converter's "Multiple sources driving net" error.
//
// digitaljs Constant devices DO render 'z' (high-impedance) even though its value
// engine (3vl) is 3-valued, so 'z' bits pass through and display as 'z' constants;
// only live value propagation collapses z->x.
// digitaljs nets allow only a single source. When a net is driven by more than
// one cell output (e.g. a reg written by both an always_comb and an always_ff —
// ambiguous/illegal hardware that yosys still emits), yosys2digitaljs throws
// "Multiple sources driving net". Rather than fail, surface the conflict
// honestly: reroute each driver onto its own private net and merge them through
// a labeled $mux "resolver" whose select is constant x ("resolution undefined"),
// so the schematic shows every source converging on the contended net instead of
// silently dropping one. Only exact same-width overlaps are handled (the common
// whole-reg case); partial-bit overlaps are left for the converter to report.
function resolveMultiDrivers(mod: any, allocBits: (n: number) => number[]): void {
    const byBits = new Map<string, { cell: any; port: string }[]>();
    for (const cell of Object.values<any>(mod.cells ?? {})) {
        for (const [port, conn] of Object.entries<any>(cell.connections ?? {})) {
            if (cell.port_directions?.[port] !== 'output') { continue; }
            if (!Array.isArray(conn) || conn.some((b: any) => typeof b !== 'number')) { continue; }
            const key = JSON.stringify(conn);
            const list = byBits.get(key) ?? [];
            list.push({ cell, port });
            byBits.set(key, list);
        }
    }
    let tag = 0;
    for (const [key, drivers] of byBits) {
        if (drivers.length < 2) { continue; }
        const origBits: number[] = JSON.parse(key);
        const w = origBits.length;
        // Reroute every driver to its own private net.
        const sources = drivers.map(({ cell, port }) => {
            const priv = allocBits(w);
            cell.connections[port] = priv;
            return priv;
        });
        // Merge through a chain of $mux resolvers (select = constant x).
        let acc: any[] = sources[0];
        for (let i = 1; i < sources.length; i++) {
            const Y = i === sources.length - 1 ? origBits : allocBits(w);
            mod.cells[`$multidriver$${tag++}`] = {
                type: '$mux',
                parameters: { WIDTH: w },
                port_directions: { A: 'input', B: 'input', S: 'input', Y: 'output' },
                connections: { A: acc, B: sources[i], S: ['x'], Y },
                attributes: { multidriver: 1 },
                hide_name: 0,
            };
            acc = Y;
        }
    }
}

// Mutates yosysJson in place; returns module name -> set of port names that were `inout`
// (so convertToDigitalJs can mark the corresponding Input/Output devices bidirectional).
function normalizeForDigitaljs(yosysJson: any): Map<string, Set<string>> {
    const inoutByModule = new Map<string, Set<string>>();
    // Yosys JSON int params may be plain numbers (-compat-int) or bit strings
    const decodeInt = (v: any, dflt: number): number => {
        if (typeof v === 'number') { return v; }
        if (typeof v === 'string') { return parseInt(v, 2) || dflt; }
        return dflt;
    };
    for (const [modName, mod] of Object.entries<any>(yosysJson.modules ?? {})) {
        // fresh net-bit id allocator for transforms that need internal nets
        let nextBit = 2;
        const scanBits = (bits: any[]) => {
            for (const b of bits) { if (typeof b === 'number' && b >= nextBit) { nextBit = b + 1; } }
        };
        for (const port of Object.values<any>(mod.ports ?? {})) { scanBits(port.bits ?? []); }
        for (const nn of Object.values<any>(mod.netnames ?? {})) { scanBits(nn.bits ?? []); }
        for (const cell of Object.values<any>(mod.cells ?? {})) {
            for (const conn of Object.values<any>(cell.connections ?? {})) { scanBits(conn as any[]); }
        }
        const allocBits = (n: number) => Array.from({ length: n }, () => nextBit++);

        // Module inout ports -> output (a sink Output box inside the module). Record them so the
        // resulting Input/Output devices can be marked bidirectional.
        const inoutPorts = new Set<string>();
        for (const [pname, port] of Object.entries<any>(mod.ports ?? {})) {
            if (port.direction === 'inout') { inoutPorts.add(pname); port.direction = 'output'; }
        }
        if (inoutPorts.size > 0) { inoutByModule.set(modName, inoutPorts); }

        // digitaljs has no bidirectional net, so each inout net needs exactly one source or no wire
        // is drawn. Group inout cell-pins by net; if a net already has a real driver (a cell output,
        // or a module input) keep them all as sinks (input); otherwise promote ONE pin to output so
        // the connection renders. Only sourceless nets are promoted -> no new multi-driver is forced
        // (resolveMultiDrivers is the backstop). Module inout->output ports are SINKS, not drivers.
        const inoutPinsByNet = new Map<string, { cell: any; pin: string }[]>();
        const drivenNets = new Set<string>();
        for (const port of Object.values<any>(mod.ports ?? {})) {
            if (port.direction === 'input' && Array.isArray(port.bits)) { drivenNets.add(JSON.stringify(port.bits)); }
        }
        for (const cell of Object.values<any>(mod.cells ?? {})) {
            for (const [pname, pdir] of Object.entries<any>(cell.port_directions ?? {})) {
                const conn = cell.connections?.[pname];
                if (!Array.isArray(conn)) { continue; }
                const key = JSON.stringify(conn);
                if (pdir === 'output') { drivenNets.add(key); }
                else if (pdir === 'inout') {
                    const list = inoutPinsByNet.get(key) ?? [];
                    list.push({ cell, pin: pname });
                    inoutPinsByNet.set(key, list);
                }
            }
        }
        for (const [key, pins] of inoutPinsByNet) {
            const promote = !drivenNets.has(key);
            pins.forEach((p, i) => {
                p.cell.port_directions[p.pin] = (promote && i === 0) ? 'output' : 'input';
            });
        }

        for (const [cellName, cell] of Object.entries<any>(mod.cells ?? {})) {
            // $bmux (Y = word S of the packed array A; emitted for indexed reads like
            // `rom[addr]` that don't infer a memory) has no converter mapping. For
            // power-of-2 word widths it is exactly $shiftx by S*WIDTH, where the
            // multiply is a zero-pad of the select — a single supported cell.
            if (cell.type === '$bmux') {
                const width = decodeInt(cell.parameters?.WIDTH, cell.connections.Y.length);
                const log2w = Math.log2(width);
                if (Number.isInteger(log2w)) {
                    const shiftBits = [...Array(log2w).fill('0'), ...cell.connections.S];
                    cell.type = '$shiftx';
                    cell.connections = { A: cell.connections.A, B: shiftBits, Y: cell.connections.Y };
                    cell.port_directions = { A: 'input', B: 'input', Y: 'output' };
                    cell.parameters = {
                        A_SIGNED: 0, B_SIGNED: 0,
                        A_WIDTH: cell.connections.A.length,
                        B_WIDTH: shiftBits.length,
                        Y_WIDTH: width,
                    };
                }
                // non-power-of-2 word width: leave as-is (clear converter error names it)
            }
            // $demux (word S of Y = A, zeros elsewhere; the write-side dual of $bmux)
            // is exactly $shl: Y = zero_extend(A) << S*WIDTH.
            if (cell.type === '$demux') {
                const width = decodeInt(cell.parameters?.WIDTH, cell.connections.A.length);
                const log2w = Math.log2(width);
                if (Number.isInteger(log2w)) {
                    const shiftBits = [...Array(log2w).fill('0'), ...cell.connections.S];
                    cell.type = '$shl';
                    cell.connections = { A: cell.connections.A, B: shiftBits, Y: cell.connections.Y };
                    cell.port_directions = { A: 'input', B: 'input', Y: 'output' };
                    cell.parameters = {
                        A_SIGNED: 0, B_SIGNED: 0,
                        A_WIDTH: cell.connections.A.length,
                        B_WIDTH: shiftBits.length,
                        Y_WIDTH: cell.connections.Y.length,
                    };
                }
            }
            // $tribuf (Y = EN ? A : z) has no converter mapping; rewrite as a $mux
            // selecting between the high-Z constant ("bus released") and the driven
            // value. digitaljs renders the 'z' constant, so this is a faithful
            // tristate-driver depiction. src attributes are preserved.
            if (cell.type === '$tribuf') {
                const width = cell.connections.A.length;
                cell.type = '$mux';
                cell.connections = {
                    A: Array(width).fill('z'),
                    B: cell.connections.A,
                    S: cell.connections.EN,
                    Y: cell.connections.Y,
                };
                cell.port_directions = { A: 'input', B: 'input', S: 'input', Y: 'output' };
                cell.parameters = { WIDTH: width };
            }
            // $bwmux (per-bit select: Y[i] = S[i] ? B[i] : A[i]; from masked array
            // writes) has no single supported equivalent — decompose into the gate
            // identity Y = (A & ~S) | (B & S). src attributes are copied to all parts.
            if (cell.type === '$bwmux') {
                const w = cell.connections.Y.length;
                const notS = allocBits(w);
                const aPart = allocBits(w);
                const bPart = allocBits(w);
                const binParams = { A_SIGNED: 0, B_SIGNED: 0, A_WIDTH: w, B_WIDTH: w, Y_WIDTH: w };
                const mk = (type: string, connections: any, parameters: any) => ({
                    type, connections, parameters,
                    port_directions: Object.fromEntries(Object.keys(connections).map(k => [k, k === 'Y' ? 'output' : 'input'])),
                    attributes: { ...cell.attributes },
                    hide_name: 1,
                });
                mod.cells[`${cellName}$bw_not`] = mk('$not',
                    { A: cell.connections.S, Y: notS }, { A_SIGNED: 0, A_WIDTH: w, Y_WIDTH: w });
                mod.cells[`${cellName}$bw_and0`] = mk('$and',
                    { A: cell.connections.A, B: notS, Y: aPart }, binParams);
                mod.cells[`${cellName}$bw_and1`] = mk('$and',
                    { A: cell.connections.B, B: cell.connections.S, Y: bPart }, binParams);
                mod.cells[`${cellName}$bw_or`] = mk('$or',
                    { A: aPart, B: bPart, Y: cell.connections.Y }, binParams);
                delete mod.cells[cellName];
            }
        }
        resolveMultiDrivers(mod, allocBits);
    }
    return inoutByModule;
}

// Mark the Input/Output devices that came from `inout` ports as bidirectional, directly in the
// digitaljs JSON. digitaljs clones device fields onto the cell model, so the webview reads
// cell.get('bidir') and draws a bidirectional pin glyph. The flag rides per module graph (top +
// each nested subcircuit), so popups and multiple panels carry it with no side channel.
function tagBidirPorts(djs: any, inoutByModule: Map<string, Set<string>>): void {
    if (!djs || inoutByModule.size === 0) { return; }
    const subcircuits = djs.subcircuits ?? {};
    const tagGraph = (graph: any, ports: Set<string> | undefined) => {
        if (!graph || !ports || !graph.devices) { return; }
        for (const dev of Object.values<any>(graph.devices)) {
            if ((dev.type === 'Input' || dev.type === 'Output') && ports.has(dev.net)) { dev.bidir = true; }
        }
    };
    for (const [modName, graph] of Object.entries<any>(subcircuits)) {
        tagGraph(graph, inoutByModule.get(modName));
    }
    // the top module is spread into djs (not under subcircuits): the one inout module not nested.
    const topName = [...inoutByModule.keys()].find(m => !(m in subcircuits));
    if (topName) { tagGraph(djs, inoutByModule.get(topName)); }
}

// A declared-but-unconnected named net has no driver and no load, so yosys2digitaljs emits no edge
// for it and opt_clean deletes it outright. When the caller wants them shown, find the public nets
// in the top module whose bits aren't connected to any cell port or module port (requires the Yosys
// run to have kept public wires — see buildScript's showDangling path; otherwise they're gone).
export function findDanglingNets(yosysJson: any): { name: string; bits: number }[] {
    const modules = yosysJson?.modules;
    if (!modules) { return []; }
    const top: any = Object.values(modules).find((m: any) => m?.attributes?.top) || Object.values(modules)[0];
    if (!top) { return []; }
    const connected = new Set<number>();
    const add = (bits: any) => { if (Array.isArray(bits)) { for (const b of bits) { if (typeof b === 'number') { connected.add(b); } } } };
    for (const cell of Object.values(top.cells || {})) { for (const c of Object.values((cell as any).connections || {})) { add(c); } }
    for (const p of Object.values(top.ports || {})) { add((p as any).bits); }
    const out: { name: string; bits: number }[] = [];
    for (const [name, net] of Object.entries(top.netnames || {})) {
        if (name.startsWith('$')) { continue; } // internal/auto net, not user-meaningful
        const numeric = ((net as any).bits || []).filter((b: any) => typeof b === 'number');
        // dangling = has real bits, none of which are connected anywhere (constant-tied nets are driven)
        if (numeric.length && numeric.every((b: number) => !connected.has(b))) { out.push({ name, bits: numeric.length }); }
    }
    return out;
}

// Add a labelled stub device per dangling net so the webview can render it (there's no wire to draw,
// so it shows as a dashed, port-less box bearing the net name). Marked `dangling` for styling.
function addDanglingNetStubs(djs: any, dangling: { name: string; bits: number }[]): void {
    if (!djs.devices) { djs.devices = {}; }
    let order = 0;
    for (const d of Object.values(djs.devices) as any[]) {
        if (typeof d.order === 'number' && d.order >= order) { order = d.order + 1; }
    }
    let i = 0;
    for (const { name, bits } of dangling) {
        djs.devices[`$dangling${i++}`] = { type: 'Input', net: name, order: order++, bits: bits || 1, dangling: true };
    }
}

export function convertToDigitalJs(yosysJson: any, opts?: { showDangling?: boolean }): any {
    // compute BEFORE normalizeForDigitaljs mutates the netlist
    const dangling = opts?.showDangling ? findDanglingNets(yosysJson) : [];
    try {
        const inoutByModule = normalizeForDigitaljs(yosysJson); // mutates yosysJson, returns inout ports
        const djs = yosys2digitaljs(yosysJson);
        tagBidirPorts(djs, inoutByModule);
        if (dangling.length) { addDanglingNetStubs(djs, dangling); }
        return djs;
    } catch (e: any) {
        const msg = String(e?.message ?? e);
        const m = msg.match(/Invalid cell type: (.*)/);
        if (m) {
            throw new Error(
                `Schematic converter does not support cell type '${m[1]}'. ` +
                'This is a yosys2digitaljs coverage gap — please report it ' +
                '(see docs/spikes/rtl-structural/cell_coverage.md).');
        }
        throw e;
    }
}
