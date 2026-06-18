// Shallow mode: a child box has no loaded internals (it was blackboxed at elaboration). Expanding it
// posts an `expandRequest` to the extension, which re-elaborates the child and replies with an
// `expandResult` circuit; the webview builds that into a graph and opens it as a popup. This drives
// the full round-trip in real Chromium: trigger Expand → assert request → feed back a child circuit →
// assert a popup opened with rendered cells.
import { launchPage, loadSchematic, fixture, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo', shallow: true });

// 1. Expand a child box (via its zoom 🔍 → openSubcircuit). In shallow mode this posts an
//    expandRequest and does NOT open a popup yet.
const req = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const model = labelIndex.graph.getElements().find(e => e.get('type') === 'Subcircuit');
    if (!model) { return null; }
    window.__sent.length = 0;
    paper.findViewByModel(model).zoomInCircuit({ stopPropagation() {} });
    const m = [...window.__sent].reverse().find(x => x.type === 'expandRequest');
    const dialogsNow = document.querySelectorAll('.ui-dialog').length;
    return m ? { key: m.key, celltype: m.celltype, leafName: m.leafName, dialogsNow } : null;
});
console.log('expandRequest:', JSON.stringify(req));

// 2. Reply with a re-elaborated child circuit → a popup should open with cells. A real shallow
//    re-elaboration carries malformed connectors (blackboxed grandchildren / undriven ports), so
//    inject one (a missing `from`, the exact "reading 'id'" trigger) to ensure the same sanitize
//    guard loadSchematic uses is applied before building the temp Circuit — else digitaljs throws.
const childCircuit = fixture('fifo.digitaljs.json');
childCircuit.connectors = [
    ...(childCircuit.connectors || []),
    { to: { id: '__ghost_to__', port: 'in' }, name: '__no_from__' },                 // conn.from undefined
    { from: { id: '__ghost__', port: 'out' }, to: { id: '__ghost2__', port: 'in' }, name: '__ghost__' }, // unknown devices
];
const popup = req && await page.evaluate(async ({ childCircuit, key }) => {
    window.postMessage({ type: 'expandResult', key, circuit: childCircuit }, '*');
    await new Promise(r => setTimeout(r, 3500)); // popup build + async ELK layout
    const dlg = document.querySelector('.ui-dialog');
    return { dialogs: document.querySelectorAll('.ui-dialog').length, cells: dlg ? dlg.querySelectorAll('[model-id]').length : 0 };
}, { childCircuit, key: req.key });
console.log('popup:', JSON.stringify(popup));

const ok = report('shallow-expand', [
    ['shallow Expand posts an expandRequest (not stepInto)', !!req && typeof req.key === 'string'],
    ['no popup opens before the reply', !!req && req.dialogsNow === 0],
    ['expandResult opens exactly one popup', !!popup && popup.dialogs === 1],
    ['the popup renders the child circuit (has cells)', !!popup && popup.cells > 0],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
