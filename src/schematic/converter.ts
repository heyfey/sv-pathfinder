// C3 — Converter: Yosys JSON -> DigitalJS JSON via the published yosys2digitaljs.
// Spike 1 found no cell-coverage patches needed for the validated script presets;
// unknown $-cells throw, so surface a useful error instead of a stack trace.
const { yosys2digitaljs } = require('yosys2digitaljs/core');

// yosys2digitaljs supports only input/output ports and single-driver nets; digitaljs has
// no tristate modeling at all (3-valued logic, no z). Legacy RTL with bidirectional
// buses (`inout [7:0] data`) is common, so instead of failing, render inouts as plain
// connection points: a module-level inout becomes an output-style port box (net SINK),
// and a cell-level inout pin is treated as an input from the parent's perspective (also
// a sink). Neither adds a net source, so the transform cannot introduce the converter's
// "Multiple sources driving net" error; nets only driven through the bidir path render
// as undriven (x) — acceptable for a structural view. 'z' constant bits map to 'x'
// (same rule as value annotation; digitaljs cannot display z).
function normalizeForDigitaljs(yosysJson: any): any {
    const zToX = (bits: any[]) => bits.map(b => (b === 'z' || b === 'Z') ? 'x' : b);
    // Yosys JSON int params may be plain numbers (-compat-int) or bit strings
    const decodeInt = (v: any, dflt: number): number => {
        if (typeof v === 'number') { return v; }
        if (typeof v === 'string') { return parseInt(v, 2) || dflt; }
        return dflt;
    };
    for (const mod of Object.values<any>(yosysJson.modules ?? {})) {
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

        for (const port of Object.values<any>(mod.ports ?? {})) {
            if (port.direction === 'inout') { port.direction = 'output'; }
            if (Array.isArray(port.bits)) { port.bits = zToX(port.bits); }
        }
        for (const [cellName, cell] of Object.entries<any>(mod.cells ?? {})) {
            for (const [pname, pdir] of Object.entries<any>(cell.port_directions ?? {})) {
                if (pdir === 'inout') { cell.port_directions[pname] = 'input'; }
            }
            for (const [cname, conn] of Object.entries<any>(cell.connections ?? {})) {
                if (Array.isArray(conn)) { cell.connections[cname] = zToX(conn); }
            }
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
            // selecting between all-x ("bus released") and the driven value — the exact
            // 3-valued rendering of a tristate driver. src attributes are preserved.
            if (cell.type === '$tribuf') {
                const width = cell.connections.A.length;
                cell.type = '$mux';
                cell.connections = {
                    A: Array(width).fill('x'),
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
        for (const nn of Object.values<any>(mod.netnames ?? {})) {
            if (Array.isArray(nn.bits)) { nn.bits = zToX(nn.bits); }
        }
    }
    return yosysJson;
}

export function convertToDigitalJs(yosysJson: any): any {
    try {
        return yosys2digitaljs(normalizeForDigitaljs(yosysJson));
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
