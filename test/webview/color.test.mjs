// Instance vs. gate styling, and that value coloring co-exists with it. Child-instance (Subcircuit)
// bodies are accent-tinted so they read as hierarchy boundaries, distinct from primitive gates;
// driving a net high still paints its wire green on top of that.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

const r = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const g = labelIndex.graph;
    const fillOf = (m, sel) => { const v = paper.findViewByModel(m); const b = v && v.el.querySelector(sel); return b ? getComputedStyle(b).fill : null; };
    const sub = g.getElements().find(e => e.get('type') === 'Subcircuit');
    const gate = g.getElements().find(e => !['Subcircuit', 'Input', 'Output'].includes(e.get('type')));
    return { subFill: fillOf(sub, '[joint-selector="body"]'), gateFill: fillOf(gate, '[joint-selector="body"]') };
});
console.log('FILLS:', JSON.stringify(r));

await page.evaluate(() => window.postMessage({ type: 'setValues', updates: [{ name: 'full', values: ['1'] }, { name: 'empty', values: ['0'] }] }, '*'));
await page.waitForTimeout(400);
const wire = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const w = labelIndex.wires['full'];
    const line = w && paper.findViewByModel(w).el.querySelector('.connection');
    return { sig: w ? w.get('signal').toBin() : null, stroke: line ? getComputedStyle(line).stroke : null };
});
console.log('WIRE full=1:', JSON.stringify(wire));

const green = 'rgb(47, 179, 68)';
const ok = report('color', [
    ['instance body tinted (differs from gate body)', !!r.subFill && r.subFill !== r.gateFill],
    ['driven full=1 -> green wire', wire.sig === '1' && wire.stroke === green],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
