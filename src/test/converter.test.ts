import * as assert from 'assert';
import * as fs from 'fs';
import path from 'path';

import { convertToDigitalJs, findDanglingNets } from '../schematic/converter';

// Fixtures live in src/ (not copied to out/ by tsc), so resolve from the repo root.
const FIXTURES = path.resolve(__dirname, '../../src/test/fixtures');
function fixture(name: string): any {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

// digitaljs has no bidirectional-port modeling. The converter (normalizeForDigitaljs + tagBidirPorts)
// bridges that gap: an `inout` net with no real driver still gets one nominal source so a wire is
// drawn between the instances, and the resulting Input/Output devices are tagged `bidir` so the
// webview can render the ⇄ glyph. synth_inout is two instances (u_a, u_b) of an `iobuf` module whose
// only port is `inout [3:0] bus`, wired together — the minimal shape that exercises both behaviours.
suite('convertToDigitalJs — inout handling', () => {
    test('two inout instances are wired together (a connector is drawn for the inout net)', () => {
        const djs = convertToDigitalJs(fixture('synth_inout.yosys.json'));

        const subs = Object.entries(djs.devices)
            .filter(([, d]: any) => d.type === 'Subcircuit')
            .map(([id, d]: any) => ({ id, label: d.label, celltype: d.celltype }));
        assert.deepStrictEqual(subs.map(s => s.label).sort(), ['u_a', 'u_b']);
        assert.ok(subs.every(s => s.celltype === 'iobuf'), 'both instances are iobuf subcircuits');

        const busConns = djs.connectors.filter((c: any) => c.name === 'bus');
        assert.strictEqual(busConns.length, 1, 'exactly one wire drawn for the inout bus');
        const conn = busConns[0];
        const ids = new Set(subs.map(s => s.id));
        assert.ok(conn.from && conn.to, 'connector has both endpoints');
        assert.ok(ids.has(conn.from.id) && ids.has(conn.to.id), 'wire connects the two iobuf instances');
        assert.strictEqual(conn.from.port, 'bus');
        assert.strictEqual(conn.to.port, 'bus');
    });

    test('the inout port device is tagged bidirectional', () => {
        const djs = convertToDigitalJs(fixture('synth_inout.yosys.json'));

        const iobuf = djs.subcircuits && djs.subcircuits.iobuf;
        assert.ok(iobuf, 'iobuf subcircuit is present');
        const ports = Object.values(iobuf.devices)
            .filter((d: any) => d.type === 'Input' || d.type === 'Output');
        const busPort: any = ports.find((d: any) => d.net === 'bus');
        assert.ok(busPort, 'iobuf has a bus port device');
        assert.strictEqual(busPort.bidir, true, 'bus port is tagged bidirectional');
    });
});

// A declared-but-unconnected named net has no edge to draw. The schematicShowDanglingNets path keeps
// such nets through Yosys, finds them, and adds a labelled stub so the webview can show one. The
// fixture's top module has a connected `a`/`y` (input -> $not -> output) plus a fully unconnected
// public `dead_bus` and a private `$auto$internal` (which must be ignored).
suite('findDanglingNets / showDangling', () => {
    test('finds only the unconnected public net (skips connected + private)', () => {
        const dangling = findDanglingNets(fixture('synth_dangling.yosys.json'));
        assert.deepStrictEqual(dangling, [{ name: 'dead_bus', bits: 4 }]);
    });

    test('showDangling adds a labelled stub device; off by default adds none', () => {
        const on = convertToDigitalJs(fixture('synth_dangling.yosys.json'), { showDangling: true });
        const stubs = Object.values(on.devices).filter((d: any) => d.dangling);
        assert.strictEqual(stubs.length, 1, 'one stub for dead_bus');
        assert.strictEqual((stubs[0] as any).net, 'dead_bus');
        assert.strictEqual((stubs[0] as any).bits, 4);

        const off = convertToDigitalJs(fixture('synth_dangling.yosys.json'));
        assert.strictEqual(Object.values(off.devices).filter((d: any) => d.dangling).length, 0, 'none without the flag');
    });
});
