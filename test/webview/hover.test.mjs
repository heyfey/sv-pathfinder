// Hover highlight: a cheap stroke change (NOT a drop-shadow filter, which repaints the whole SVG on
// every mouse move). The wire thickens to 6px — chosen > a bus's native 4px so buses visibly change
// too (single-bit wires are 2px) — without altering the wire's value COLOR (palette preserved).
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

const probe = (name) => page.evaluate((nm) => {
    const { paper, labelIndex } = window.__schematic;
    const v = paper.findViewByModel(labelIndex.wires[nm]);
    const line = v.el.querySelector('.connection');
    const read = () => ({ width: getComputedStyle(line).strokeWidth, stroke: getComputedStyle(line).stroke, filter: getComputedStyle(line).filter });
    const before = read();
    v.el.classList.add('sv-hover');
    const hover = read();
    v.el.classList.remove('sv-hover');
    return { bits: labelIndex.wires[nm].get('bits'), before, hover };
}, name);

const clk = await probe('clk');   // single-bit, native 2px
const din = await probe('din');   // 8-bit bus, native 4px
console.log('clk:', JSON.stringify(clk));
console.log('din:', JSON.stringify(din));

const ok = report('hover', [
    ['single-bit wire 2px -> 6px on hover', clk.before.width === '2px' && clk.hover.width === '6px'],
    ['BUS wire 4px -> 6px on hover (the bug)', din.before.width === '4px' && din.hover.width === '6px'],
    ['hover is NOT a drop-shadow filter', clk.hover.filter === 'none' && din.hover.filter === 'none'],
    ['hover does not change wire value color', clk.hover.stroke === clk.before.stroke && din.hover.stroke === din.before.stroke],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
