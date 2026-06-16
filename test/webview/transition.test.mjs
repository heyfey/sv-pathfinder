// Value transitions: a value array of length>1 renders old→new across the whole chain (keeping
// glitches), on wires, child-instance ports and boxed IO ports.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

await page.evaluate(() => window.postMessage({ type: 'setValues', updates: [
    { name: 'clk', values: ['0', '1'] },                  // transition -> "0→1"
    { name: 'rst_n', values: ['1'] },                     // stable -> "1"
    { name: 'full', values: ['1', '0'] },                 // transition -> "1→0"
    { name: 'din', values: ['00001111', '11110000'] },    // bus transition -> "0x0f→0xf0"
    { name: 'push', values: ['0', '1', '0'] },            // GLITCH -> "0→1→0"
    { name: 'pop', values: ['x'] },                       // annotated x -> "x"
] }, '*'));
await page.waitForTimeout(500);

const r = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const wireTxt = {};
    for (const name of ['clk', 'rst_n', 'full', 'din', 'push', 'pop']) {
        const w = labelIndex.wires[name];
        const node = w && paper.findViewByModel(w).el.querySelector('.wirevalue');
        wireTxt[name] = node ? node.textContent : '(none)';
    }
    const sub = labelIndex.graph.getElements().find(e => e.get('type') === 'Subcircuit' && paper.findViewByModel(e));
    const sv = paper.findViewByModel(sub);
    const portTxt = {};
    for (const p of sub.getPorts()) {
        const c = sv._portElementsCache[p.id];
        const n = c && c.portSelectors && c.portSelectors.iovalue;
        if (n && n.textContent) { portTxt[p.id] = n.textContent; }
    }
    const io = labelIndex.graph.getElements().find(e => e.get('net') === 'clk');
    const ion = io && paper.findViewByModel(io).selectors.ioval;
    return { wireTxt, portTxt, ioClk: ion ? ion.textContent : null };
});
console.log(JSON.stringify(r, null, 1));

const ok = report('transition', [
    ['wire clk = 0→1', r.wireTxt.clk === '0→1'],
    ['wire rst_n = 1 (stable)', r.wireTxt.rst_n === '1'],
    ['wire full = 1→0', r.wireTxt.full === '1→0'],
    ['bus din = 0x0f→0xf0', r.wireTxt.din === '0x0f→0xf0'],
    ['GLITCH push = 0→1→0', r.wireTxt.push === '0→1→0'],
    ['annotated x pop = "x"', r.wireTxt.pop === 'x'],
    ['IO box clk = 0→1', r.ioClk === '0→1'],
    ['subcircuit port shows clk 0→1', Object.values(r.portTxt).includes('0→1')],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
