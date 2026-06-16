// Benchmark (NOT a gated test — name is perf.mjs, not *.test.mjs). Generates synthetic flat-scope
// circuits of increasing size and measures the two costs that scale: ELK layout-settle on open, and
// a full setValues annotation pass (the per-marker-move cost). Run: `npm run bench` (or
// `node test/webview/perf.mjs 200,1000,4000`). Needs the built bundle + Chromium (see README).
import { launchPage } from './helpers.mjs';

// A WIDE, BOUNDED-DEPTH logic cloud (~depth layers of ~width gates) — the realistic shape of a flat
// module like a pram (many parallel cells, shallow depth), not a single long chain (which would make
// ELK's layered layout near-quadratic and isn't how real RTL looks). Each gate drives a named net so
// the value-annotation walk has one wire per gate. Shapes match digitaljs converter output (And:
// in1/in2/out, Not: in/out).
function genCircuit(nGates, depth = 12) {
    const width = Math.max(2, Math.ceil(nGates / depth));
    const devices = { in_a: { type: 'Input', net: 'a', order: 0, bits: 1 },
                      in_b: { type: 'Input', net: 'b', order: 1, bits: 1 } };
    const src = { a: { id: 'in_a', port: 'out' }, b: { id: 'in_b', port: 'out' } };
    const connectors = [];
    let made = 0;
    for (let r = 0; r < depth && made < nGates; r++) {
        for (let c = 0; c < width && made < nGates; c++, made++) {
            const id = `g_${r}_${c}`, net = `n_${r}_${c}`;
            // inputs from the previous row (wrap for fan-out), or the primaries for row 0
            const s1 = r === 0 ? 'a' : `n_${r - 1}_${c % width}`;
            const s2 = r === 0 ? 'b' : `n_${r - 1}_${(c + 1) % width}`;
            if (c % 4 === 0) {
                devices[id] = { type: 'Not', bits: 1 };
                connectors.push({ from: src[s1], to: { id, port: 'in' }, name: s1 });
            } else {
                devices[id] = { type: 'And', bits: 1 };
                connectors.push({ from: src[s1], to: { id, port: 'in1' }, name: s1 });
                connectors.push({ from: src[s2], to: { id, port: 'in2' }, name: s2 });
            }
            src[net] = { id, port: 'out' };
        }
    }
    // expose the last row's first net as a primary output so there is at least one Output box
    const lastNet = `n_${Math.min(depth, Math.ceil(nGates / width)) - 1}_0`;
    if (src[lastNet]) {
        devices.out_y = { type: 'Output', net: 'y', order: 2, bits: 1 };
        connectors.push({ from: src[lastNet], to: { id: 'out_y', port: 'in' }, name: lastNet });
    }
    return { devices, connectors, subcircuits: {} };
}

// Open the circuit; return ms to initial render and to ELK-settle (positions quiet 500ms). Bails out
// after `capMs` so one pathologically slow layout can't hang the whole run.
async function measureOpen(page, circuit, capMs = 60000) {
    return page.evaluate(([c, cap]) => new Promise((resolve) => {
        const t0 = performance.now();
        let rendered = 0, timer = null;
        const done = (extra) => resolve({ render: Math.round(rendered), settle: Math.round(performance.now() - t0), ...extra });
        const settle = () => { clearTimeout(timer); timer = setTimeout(() => done({}), 500); };
        setTimeout(() => done({ capped: true }), cap);
        const poll = setInterval(() => {
            if (window.__schematic) {
                rendered = performance.now() - t0;
                clearInterval(poll);
                window.__schematic.labelIndex.graph.on('change:position', settle);
                settle(); // also covers "ELK already finished"
            }
        }, 10);
        window.postMessage({ type: 'loadSchematic', scopePath: 'tb', moduleName: 'top', circuit: c }, '*');
    }), [circuit, capMs]);
}

// Annotate every named net once; return ms for the whole setValues handler (incl. refreshValueText).
// Uses postMessage FIFO ordering: the sentinel is processed right after the (synchronous) handler.
async function measureSetValues(page, transition) {
    return page.evaluate((tr) => new Promise((resolve) => {
        const names = Object.keys(window.__schematic.labelIndex.wires);
        const updates = names.map((n) => ({ name: n, values: tr ? ['0', '1'] : ['1'] }));
        const t0 = performance.now();
        window.addEventListener('message', function once(e) {
            if (e.data === '__perfdone__') { window.removeEventListener('message', once); resolve({ nets: names.length, ms: Math.round(performance.now() - t0) }); }
        });
        window.postMessage({ type: 'setValues', updates }, '*');
        window.postMessage('__perfdone__', '*');
    }), transition);
}

const sizes = (process.argv[2] || '200,500,1000,2000,4000').split(',').map((n) => parseInt(n, 10));
console.log('size(gates) | devices | links | render(ms) | ELK-settle(ms) | setValues stable(ms) | setValues transition(ms)');
for (const n of sizes) {
    const circuit = genCircuit(n);
    const { browser, page } = await launchPage();
    const open = await measureOpen(page, circuit);
    const counts = await page.evaluate(() => ({ d: window.__schematic.labelIndex.graph.getElements().length, l: window.__schematic.labelIndex.graph.getLinks().length }));
    // let any pending ELK position-changes / reflow drain so the setValues timing isn't contaminated
    // by the open, then warm up once (discarded) and measure the steady state.
    await page.waitForTimeout(800);
    await measureSetValues(page, false);
    const stable = await measureSetValues(page, false);
    const trans = await measureSetValues(page, true);
    const elk = (open.settle - open.render) + (open.capped ? ' (capped)' : '');
    console.log(`${String(n).padStart(11)} | ${String(counts.d).padStart(7)} | ${String(counts.l).padStart(5)} | ${String(open.render).padStart(10)} | ${String(elk).padStart(14)} | ${String(stable.ms).padStart(20)} | ${String(trans.ms).padStart(24)}`);
    await browser.close();
}
