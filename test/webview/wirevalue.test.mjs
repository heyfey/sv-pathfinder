// Value text under wire net-names: every named wire's label has a `.wirevalue` text node (a
// two-line label: name over value); driving a named net shows the formatted value visibly;
// clearValues blanks them.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

const labelInfo = await page.evaluate(() => {
    const { paper } = window.__schematic;
    return {
        wirevalueNodes: [...paper.el.querySelectorAll('.wirevalue')].length,
        nameNodes: [...paper.el.querySelectorAll('.joint-link text.label')].length,
    };
});
console.log('LABELS:', JSON.stringify(labelInfo));

const updates = [
    { name: 'din', value: '1010101010101010' },
    { name: 'dout', value: '11110000' },
    { name: 'full', value: '1' },
    { name: 'empty', value: '0' },
];
await page.evaluate((u) => window.postMessage({ type: 'setValues', updates: u.map(x => ({ name: x.name, values: [x.value] })) }, '*'), updates);
await page.waitForTimeout(500);

const afterSet = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const out = {};
    for (const name of ['din', 'dout', 'full', 'empty']) {
        const wire = labelIndex.wires[name];
        if (!wire) { out[name] = '(no wire)'; continue; }
        const node = paper.findViewByModel(wire).el.querySelector('.wirevalue');
        const sig = wire.get('signal');
        let vis = false;
        if (node) { try { const b = node.getBBox(); vis = getComputedStyle(node).display !== 'none' && b.width > 0; } catch { /**/ } }
        out[name] = { text: node ? node.textContent : '(no node)', sigBin: sig && sig.toBin ? sig.toBin() : null, visible: vis };
    }
    return out;
});
console.log('AFTER setValues:', JSON.stringify(afterSet, null, 1));

await page.evaluate(() => window.postMessage({ type: 'clearValues' }, '*'));
await page.waitForTimeout(400);
const afterClear = await page.evaluate(() => [...window.__schematic.paper.el.querySelectorAll('.wirevalue')].map(n => n.textContent));

const fmt = (bin) => /^x+$/i.test(bin) ? '' : (bin.length > 4 ? '0x' + parseInt(bin, 2).toString(16) : bin);
const driven = Object.entries(afterSet).filter(([, v]) => v && v.text !== undefined && v.text !== '(no wire)');
const ok = report('wirevalue', [
    ['wirevalue nodes exist', labelInfo.wirevalueNodes > 0],
    ['one value node per name node (2-line labels)', labelInfo.wirevalueNodes === labelInfo.nameNodes],
    ['driven wires show non-empty value', driven.length > 0 && driven.every(([, v]) => v.text && v.text !== '')],
    ['driven wire values are VISIBLE (display+bbox)', driven.every(([, v]) => v.visible)],
    ['text matches formatted signal', driven.every(([, v]) => v.sigBin == null || v.text === fmt(v.sigBin))],
    ['clearValues blanks all wire values', afterClear.every(t => t === '')],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
