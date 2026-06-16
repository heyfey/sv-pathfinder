// Double-click a net/port/instance → go to source. Fires the same outbound 'contextAction' the
// right-click menu's primary navigation sends ("Go to definition" for named nets, "Go to source"
// for instances). Outbound messages are recorded in window.__sent by the test host's mock API.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

// Double-click a model and return the last outbound contextAction message (if any).
const dblFor = (which) => page.evaluate((w) => {
    const { paper, labelIndex } = window.__schematic;
    const g = labelIndex.graph;
    const model = w === 'wire' ? labelIndex.wires['clk']
        : w === 'sub' ? g.getElements().find(e => e.get('type') === 'Subcircuit')
            : g.getElements().find(e => e.get('type') === 'Input');
    if (!model) { return null; }
    window.__sent.length = 0;
    paper.trigger('cell:pointerdblclick', paper.findViewByModel(model));
    const msg = [...window.__sent].reverse().find(m => m.type === 'contextAction');
    return msg ? { action: msg.action, kind: msg.kind } : null;
}, which);

const wire = await dblFor('wire');   // named net → go to definition
const sub = await dblFor('sub');     // child instance → go to source (instantiation)
console.log('wire:', JSON.stringify(wire), '| sub:', JSON.stringify(sub));

const ok = report('dblclick', [
    ['dbl-click a named net sends a nav action', !!wire && (wire.action === 'gotoDefinition' || wire.action === 'gotoSource')],
    ['dbl-click a child instance sends gotoSource', !!sub && sub.action === 'gotoSource'],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
