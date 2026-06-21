// "Rendering…" overlay: a large schematic blocks the UI thread (Circuit build + initial render) and
// then lays out asynchronously, so we cover the canvas with a spinner until layout settles — and ONLY
// for heavy renders (a small one finishes in a frame, so no overlay flash). Mirrors the elaboration
// progress notification.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();

// 1) small design (fifo, ~95 connectors): fast path → overlay element is never even created.
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });
const small = await page.evaluate(() => ({
    overlayExists: !!document.getElementById('sv-render-overlay'),
    rendered: !!(window.__schematic && window.__schematic.labelIndex),
}));

// 2) heavy design (>1000 connectors): one Input fanning out to N Outputs (Input port 'out' → Output 'in').
const big = (n) => {
    const devices = { drv: { type: 'Input', net: 'a', order: 0, bits: 1 } };
    const connectors = [];
    for (let i = 0; i < n; i++) {
        devices['o' + i] = { type: 'Output', net: 'y' + i, order: i + 1, bits: 1 };
        connectors.push({ from: { id: 'drv', port: 'out' }, to: { id: 'o' + i, port: 'in' }, name: 'a' });
    }
    return { devices, connectors, subcircuits: {} };
};
await page.evaluate((c) => window.postMessage({ type: 'loadSchematic', scopePath: 'tb', moduleName: 'big', circuit: c }, '*'), big(1100));
// showRenderOverlay() runs synchronously in loadSchematic (before the deferred build), so the overlay is
// up immediately; sample while it's still rendering (well before the ~300ms-after-last-move settle).
await page.waitForTimeout(80);
const during = await page.evaluate(() => {
    const o = document.getElementById('sv-render-overlay');
    return { exists: !!o, display: o ? getComputedStyle(o).display : null, text: o ? o.textContent.trim() : '' };
});
// let the big render + ELK layout settle, then the overlay should be hidden and the schematic built.
await page.waitForTimeout(9000);
const after = await page.evaluate(() => {
    const o = document.getElementById('sv-render-overlay');
    return { display: o ? getComputedStyle(o).display : null, rendered: !!(window.__schematic && window.__schematic.labelIndex) };
});

console.log('small:', JSON.stringify(small), '| during:', JSON.stringify(during), '| after:', JSON.stringify(after));
const ok = report('render_overlay', [
    ['small design: no overlay created (fast path)', small.overlayExists === false && small.rendered === true],
    ['heavy design: overlay shown while rendering', during.exists === true && during.display === 'flex'],
    ['heavy overlay reads "Rendering schematic…"', /Rendering schematic/.test(during.text)],
    ['heavy design: overlay hidden after layout settles', after.display === 'none'],
    ['heavy design: schematic rendered', after.rendered === true],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
