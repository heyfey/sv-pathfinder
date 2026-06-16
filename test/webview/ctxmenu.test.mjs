// Right-click context menu filtering. For a NET (wire or boundary IO port) with a resolvable RTL
// name, "Go to source" and "Go to definition" resolve to the same place, so only "Go to definition"
// is offered. A child-instance box still offers both (they differ: instance source vs module def).
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

// Open the context menu for a representative model (wire / subcircuit / IO) and read its item labels.
const menuFor = (which) => page.evaluate((w) => {
    const { paper, labelIndex } = window.__schematic;
    const g = labelIndex.graph;
    const model = w === 'wire' ? labelIndex.wires['clk']
        : w === 'sub' ? g.getElements().find(e => e.get('type') === 'Subcircuit')
            : g.getElements().find(e => e.get('type') === 'Input');
    if (!model) { return null; }
    paper.trigger('cell:contextmenu', paper.findViewByModel(model), { clientX: 80, clientY: 80 });
    return [...document.getElementById('sv-ctxmenu').querySelectorAll('.sv-ctxitem')].map(r => r.textContent);
}, which);

const wire = await menuFor('wire');   // real net
const sub = await menuFor('sub');     // child instance
const io = await menuFor('io');       // boundary IO net
console.log('wire:', JSON.stringify(wire), '| sub:', JSON.stringify(sub), '| io:', JSON.stringify(io));

const ok = report('ctxmenu', [
    ['wire: has "Go to definition"', wire.includes('Go to definition')],
    ['wire: NO "Go to source" (deduped)', !wire.includes('Go to source')],
    ['IO net: "Go to definition" yes, "Go to source" no', io.includes('Go to definition') && !io.includes('Go to source')],
    ['subcircuit: still has BOTH', sub.includes('Go to source') && sub.includes('Go to definition')],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
