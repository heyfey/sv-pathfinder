// The schematic shows a persistent "limited engine" badge in the status bar when it was rendered by
// the limited (yowasp) fallback, so an incomplete render is recognizably the fallback's doing. A
// full (slang) backend shows no badge.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();

// Limited backend → badge present, amber, with an explanatory tooltip.
await loadSchematic(page, 'fifo.digitaljs.json', {
    scopePath: 'tb.u_fifo', moduleName: 'param_fifo',
    backend: 'yowasp-yosys WASM (yowasp-yosys)', limited: true,
});
const limited = await page.evaluate(() => {
    const b = document.getElementById('sv-backend-badge');
    return { present: !!b, text: b?.textContent?.trim(), inStatus: b?.parentElement?.id === 'status', tip: b?.title || '' };
});
console.log('limited:', JSON.stringify(limited));

// Re-render with a full backend → badge removed.
await loadSchematic(page, 'fifo.digitaljs.json', {
    scopePath: 'tb.u_fifo', moduleName: 'param_fifo',
    backend: 'yosys+slang (yosys)', limited: false,
});
const full = await page.evaluate(() => ({ present: !!document.getElementById('sv-backend-badge') }));
console.log('full:', JSON.stringify(full));

const ok = report('backend_badge', [
    ['limited backend shows the badge in the status bar', limited.present && limited.inStatus],
    ['badge reads "limited engine"', /limited engine/i.test(limited.text || '')],
    ['badge tooltip points at OSS CAD Suite setup', /ossCadSuitePath/.test(limited.tip)],
    ['full backend shows no badge', !full.present],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
