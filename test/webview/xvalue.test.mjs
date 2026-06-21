// Anomaly-forward colors: x->red, z->amber, 0->calm grey, 1->green, no-data->recessive grey.
// Plus x/z-aware value text (ax, zz, x). (The host leaves charts-yellow / descriptionForeground /
// disabledForeground undefined, so the webview's fallbacks apply — asserted below.)
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

const probe = (name) => page.evaluate((nm) => {
    const { paper, labelIndex } = window.__schematic;
    const w = labelIndex.wires[nm];
    if (!w) { return null; }
    const v = paper.findViewByModel(w);
    const line = v.el.querySelector('.connection');
    const n = v.el.querySelector('.wirevalue');
    return { stroke: getComputedStyle(line).stroke, text: n ? n.textContent : null };
}, name);

const beforeDin = await probe('din'); // before any waveform: no-data grey + blank

await page.evaluate(() => window.postMessage({ type: 'setValues', updates: [
    { name: 'full', values: ['1'] },         // high  -> green '1'
    { name: 'empty', values: ['0'] },        // low   -> grey  '0'
    { name: 'clk', values: ['x'] },          // x     -> red   'x'
    { name: 'rst_n', values: ['z'] },        // z     -> amber 'z'
    { name: 'din', values: ['1010xxxx'] },   // partial-x bus -> red 'ax'
    { name: 'dout', values: ['zzzzzzzz'] },  // all-z bus     -> amber 'zz'
    { name: 'wptr', values: ['xxx'] },       // small x bus   -> red 'xxx'
] }, '*'));
await page.waitForTimeout(600);

const r = {};
for (const n of ['full', 'empty', 'clk', 'rst_n', 'din', 'dout', 'wptr', 'pop']) { r[n] = await probe(n); }
console.log('before(no wave) din:', JSON.stringify(beforeDin));
console.log(JSON.stringify(r, null, 1));

// clearValues must blank even x/z values. Their signal was ALREADY x, so clearing fires no reactive
// change event — the forced refreshValueText pass must catch them. Guards the refreshValueText
// optimization that restricts the link sweep to nets annotated now-or-last-batch (an x/z net is in
// "last batch", so it must still be refreshed and blanked).
await page.evaluate(() => window.postMessage({ type: 'clearValues' }, '*'));
await page.waitForTimeout(400);
const afterClear = await page.evaluate(() => [...window.__schematic.paper.el.querySelectorAll('.wirevalue')].map(n => n.textContent));
console.log('after clearValues, still-shown:', JSON.stringify(afterClear.filter(t => t !== '')));

const green = 'rgb(47, 179, 68)', grey0 = 'rgb(187, 187, 187)', red = 'rgb(241, 76, 76)', amber = 'rgb(229, 160, 0)', nodata = 'rgb(136, 136, 136)';
const ok = report('xvalue', [
    ['no-waveform din = no-data grey + blank', beforeDin.stroke === nodata && beforeDin.text === ''],
    ['clearValues blanks even x/z values (no reactive change → forced refresh)', afterClear.every(t => t === '')],
    ['1 -> green "1"', r.full.stroke === green && r.full.text === '1'],
    ['0 -> calm grey (NOT red) "0"', r.empty.stroke === grey0 && r.empty.text === '0'],
    ['x -> red "x"', r.clk.stroke === red && r.clk.text === 'x'],
    ['z -> amber "z"', r.rst_n.stroke === amber && r.rst_n.text === 'z'],
    ['partial-x bus -> red "ax"', r.din.stroke === red && r.din.text === 'ax'],
    ['all-z bus -> amber "zz"', r.dout.stroke === amber && r.dout.text === 'zz'],
    ['small x bus -> red "xxx"', r.wptr.stroke === red && r.wptr.text === 'xxx'],
    ['undriven pop -> no-data grey + blank', r.pop.stroke === nodata && r.pop.text === ''],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
