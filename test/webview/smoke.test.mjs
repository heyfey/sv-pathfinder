import { launchPage, loadSchematic, report } from './helpers.mjs';
const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });
const r = await page.evaluate(() => ({
  status: document.getElementById('status-text').textContent,
  rendered: !!(window.__schematic && window.__schematic.labelIndex),
  nets: window.__schematic ? Object.keys(window.__schematic.labelIndex.wires).length : 0,
}));
console.log(JSON.stringify(r));
const ok = report('smoke', [
  ['renders', r.rendered === true],
  ['status shows nets', /named nets/.test(r.status)],
  ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
