// Robustness: a few malformed connectors (a foreign yosys on PATH can emit JSON our converter
// didn't expect) must not abort the whole render — they're dropped with a backend-tagged warning,
// the rest renders. A genuinely broken circuit fails with a status that names the backend, so the
// user knows which tool produced the bad netlist.
import { fixture, launchPage, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();

// --- A: inject malformed connectors (endpoints that name no device) -> render survives, warns ---
const bad = fixture('fifo.digitaljs.json');
bad.connectors.push({ from: undefined, to: { id: 'x', port: 'in' } });        // missing from
bad.connectors.push({ from: { id: 'y' }, to: { id: 'z', port: 'in' } });      // from names no device
bad.connectors.push({ from: { port: 'out' }, to: { id: 'z', port: 'in' } });  // missing from.id
await page.evaluate((c) => window.postMessage({ type: 'loadSchematic', circuit: c, scopePath: 'tb.u_fifo', moduleName: 'param_fifo', backend: 'yosys+slang (/opt/oss/bin/yosys)' }, '*'), bad);
await page.waitForTimeout(4000);
const a = await page.evaluate(() => ({
    status: document.getElementById('status-text').textContent,
    rendered: !!(window.__schematic && window.__schematic.labelIndex),
}));
console.log('A status:', a.status, '| rendered:', a.rendered);

// --- B: a genuinely broken circuit -> error status names the backend ---
await page.evaluate(() => window.postMessage({ type: 'loadSchematic', circuit: null, scopePath: 'tb', moduleName: 'broken', backend: 'yosys native (/usr/bin/yosys)' }, '*'));
await page.waitForTimeout(800);
const b = await page.evaluate(() => document.getElementById('status-text').textContent);
console.log('B status:', b);

const ok = report('malformed', [
    ['malformed-connector render survived', a.rendered === true && !/Failed to render/.test(a.status)],
    ['dropped-connector warning logged', logs.some(l => /dropped 3 malformed connector/.test(l))],
    ['failure names the backend', /Failed to render/.test(b) && /\[backend: yosys native/.test(b)],
], logs);
console.log('warns:', JSON.stringify(logs.filter(l => /dropped|malformed/.test(l))));
await browser.close();
process.exit(ok ? 0 : 1);
