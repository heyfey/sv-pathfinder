// Per-port value annotation on child-instance (Subcircuit) boxes:
//  - box row pitch grows to spacing.rowH (reserves a value line under each port name)
//  - each subcircuit port has an `iovalue` text node
//  - driving a port's connected net makes that port's iovalue show the formatted value (visibly)
//  - clearValues blanks them again
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

const info = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const graph = labelIndex.graph;
    const subs = graph.getElements().filter(e => e.get('type') === 'Subcircuit');
    if (!subs.length) { return { error: 'no subcircuits at this scope' }; }
    const sub = subs.find(s => paper.findViewByModel(s)) || subs[0];
    const view = paper.findViewByModel(sub);
    const ports = sub.getPorts();
    const vcount = Math.max(ports.filter(p => p.group === 'in').length, ports.filter(p => p.group === 'out').length);
    const links = graph.getConnectedLinks(sub);
    const portNets = [];
    for (const p of ports) {
        const w = links.find(l => {
            const s = l.get('source'), t = l.get('target');
            return (s && s.id === sub.id && s.port === p.id) || (t && t.id === sub.id && t.port === p.id);
        });
        const nm = w && w.get('netname');
        if (nm && labelIndex.wires[nm]) { portNets.push({ port: p.id, group: p.group, net: nm }); }
    }
    return {
        height: sub.size().height, vcount, expectedHeight: vcount * 28 + 8, // compact rowH = 28
        iovalueNodes: view.el.querySelectorAll('text.iovalue').length, portNets,
    };
});
console.log('SUBCIRCUIT:', JSON.stringify(info, null, 1));

const driven = info.portNets.map((pn, i) => ({ ...pn, value: (i % 2 === 0) ? '1' : '1010' }));
await page.evaluate((updates) => window.postMessage({ type: 'setValues', updates }, '*'),
    driven.map(d => ({ name: d.net, values: [d.value] })));
await page.waitForTimeout(500);

const afterSet = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const sub = labelIndex.graph.getElements().find(e => e.get('type') === 'Subcircuit' && paper.findViewByModel(e));
    const view = paper.findViewByModel(sub);
    const out = {};
    for (const p of sub.getPorts()) {
        const cache = view._portElementsCache[p.id];
        const node = cache && cache.portSelectors && cache.portSelectors.iovalue;
        const sig = (p.group === 'out' ? sub.get('outputSignals') : sub.get('inputSignals'))[p.id];
        let vis = false;
        if (node) { try { const b = node.getBBox(); vis = getComputedStyle(node).display !== 'none' && b.width > 0; } catch { /**/ } }
        out[p.id] = { text: node ? node.textContent : '(no node)', sigBin: sig && sig.toBin ? sig.toBin() : null, visible: vis };
    }
    return out;
});

await page.evaluate(() => window.postMessage({ type: 'clearValues' }, '*'));
await page.waitForTimeout(400);
const afterClear = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const sub = labelIndex.graph.getElements().find(e => e.get('type') === 'Subcircuit' && paper.findViewByModel(e));
    return [...paper.findViewByModel(sub).el.querySelectorAll('text.iovalue')].map(n => n.textContent);
});

const drivenSet = new Set(driven.map(d => d.port));
const drivenShown = Object.entries(afterSet).filter(([id, v]) => drivenSet.has(id) && v.text && v.text !== '');
const fmt = (bin) => /^x+$/i.test(bin) ? '' : (bin.length > 4 ? '0x' + parseInt(bin, 2).toString(16) : bin);
const mismatched = Object.values(afterSet).filter(v => v.sigBin != null && v.text !== fmt(v.sigBin) && !/^0x/.test(v.text));
const ok = report('portvalue', [
    ['has subcircuits', !info.error],
    ['box grew to rowH pitch', info.height === info.expectedHeight],
    ['iovalue nodes per port', info.iovalueNodes >= info.vcount && info.iovalueNodes > 0],
    ['driven ports show a value', drivenShown.length > 0 && drivenShown.length === driven.length],
    ['driven port values are VISIBLE (display+bbox)', drivenShown.every(([, v]) => v.visible)],
    ['text matches signal (bin side)', mismatched.length === 0],
    ['clearValues blanks all', afterClear.every(t => t === '')],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
