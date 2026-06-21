import { launchPage, loadSchematic, report } from './helpers.mjs';
const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });
const r = await page.evaluate(() => ({
  status: document.getElementById('status-text').textContent,
  rendered: !!(window.__schematic && window.__schematic.labelIndex),
  named: window.__schematic ? Object.keys(window.__schematic.labelIndex.wires).length : 0,
}));
console.log(JSON.stringify(r));
// Status: "<total> nets (<named> named), <devices> devices". total = distinct nets incl. unnamed,
// named = the wire-label index. fifo has unnamed internal nets, so total must exceed named.
const m = r.status.match(/(\d+) nets \((\d+) named\), \d+ devices/);
const ok = report('smoke', [
  ['renders', r.rendered === true],
  ['status shows "<total> nets (<named> named), <devices> devices"', !!m],
  ['named count matches the wire-label index', !!m && Number(m[2]) === r.named],
  ['total nets exceed named (unnamed internal nets counted too)', !!m && Number(m[1]) > Number(m[2])],
  ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
