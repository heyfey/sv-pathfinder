// Rich hover tooltip: on hover, a theme-aware box shows name + type + value for every
// net/bus/port/instance/gate (replacing digitaljs's bus-only Hex/Dec/Oct/Bin tooltip). Lets a user
// read a signal on a zoomed-out schematic without zooming in.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

// Hover a representative model and read the tooltip's header + key/value rows.
const tip = (which) => page.evaluate((w) => {
    const { paper, labelIndex } = window.__schematic;
    const g = labelIndex.graph;
    const model = w === 'bus' ? labelIndex.wires['din']
        : w === 'net' ? labelIndex.wires['clk']
            : w === 'io' ? g.getElements().find(e => e.get('type') === 'Input')
                : g.getElements().find(e => e.get('type') === 'Subcircuit');
    paper.trigger('cell:mouseenter', paper.findViewByModel(model), { clientX: 120, clientY: 120 });
    const t = document.getElementById('sv-tooltip');
    const h = t.querySelector('.sv-tip-header');
    const rows = {};
    for (const r of t.querySelectorAll('.sv-tip-row')) { rows[r.querySelector('.sv-tip-k').textContent] = r.querySelector('.sv-tip-v').textContent; }
    return { header: h ? h.textContent : null, rows, shown: getComputedStyle(t).display !== 'none' };
}, which);

const busNoVal = await tip('bus');                              // before any waveform
await page.evaluate(() => window.postMessage({ type: 'setValues', updates: [{ name: 'din', values: ['00001111'] }] }, '*'));
await page.waitForTimeout(400);
const busVal = await tip('bus');                               // din = 0x0f
const net = await tip('net');
const io = await tip('io');
const sub = await tip('sub');

// A Constant device's value is intrinsic (the sim engine is off, so it never reaches a wire). Hover a
// multi-bit constant and read its value/dec rows; also hover a net a constant DRIVES (no waveform, but
// statically known) and confirm it isn't blank. `kind`: 'cell' picks a multi-bit Constant device;
// 'net' picks a wire whose source is a Constant.
const conTip = (kind) => page.evaluate((k) => {
    const { paper, labelIndex } = window.__schematic;
    const g = labelIndex.graph;
    const model = k === 'cell'
        ? g.getElements().find(e => e.get('type') === 'Constant' && (e.get('constant') || '').length > 1)
        : g.getLinks().find(l => { const s = l.get('source'); const c = s && g.getCell(s.id); return c && c.get('type') === 'Constant'; });
    paper.trigger('cell:mouseenter', paper.findViewByModel(model), { clientX: 90, clientY: 90 });
    const t = document.getElementById('sv-tooltip');
    const rows = {};
    for (const r of t.querySelectorAll('.sv-tip-row')) { rows[r.querySelector('.sv-tip-k').textContent] = r.querySelector('.sv-tip-v').textContent; }
    return { header: t.querySelector('.sv-tip-header')?.textContent, rows, raw: model.get('constant') };
}, kind);
const con = await conTip('cell');
const conNet = await conTip('net');
const conDec = /^[01]+$/.test(con.raw || '') ? BigInt('0b' + con.raw).toString() : null;
console.log('bus(noval):', JSON.stringify(busNoVal));
console.log('bus(0x0f):', JSON.stringify(busVal));
console.log('net:', JSON.stringify(net), '| io:', JSON.stringify(io), '| sub:', JSON.stringify(sub));
console.log('const:', JSON.stringify(con), '| const-driven net:', JSON.stringify(conNet));

const ok = report('tooltip', [
    ['bus: header=din, type "bus [7:0]"', busNoVal.header === 'din' && busNoVal.rows.type === 'bus [7:0]'],
    ['bus: no waveform → value placeholder', /no waveform/.test(busNoVal.rows.value)],
    ['bus 0x0f: value + dec 15 + binary', busVal.rows.value === '0x0f' && busVal.rows.dec === '15' && /^0b0*1111$/.test(busVal.rows.bin)],
    ['1-bit net: type "net (1 bit)"', net.header === 'clk' && net.rows.type === 'net (1 bit)'],
    ['IO port: header + type input/output', !!io.header && (io.rows.type === 'input' || io.rows.type === 'output')],
    ['subcircuit: header + module row', !!sub.header && !!sub.rows.module],
    ['constant cell: header "constant" + 0b/0x value', con.header === 'constant' && /^0[bx]/.test(con.rows.value || '')],
    ['constant cell: decimal row matches the raw bits', con.rows.dec === conDec],
    ['constant-driven net: shows the value, not "no waveform"', !!conNet.rows.value && !/no waveform/.test(conNet.rows.value)],
    ['tooltip is shown', busVal.shown],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
