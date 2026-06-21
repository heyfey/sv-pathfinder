// Finished-layout cache: ELK layout is the slow part of a render, so the webview caches the settled
// positions per scope (keyed by the extension's layoutKey + spacing) and reapplies them on revisit —
// digitaljs then skips ELK (devices carry positions → graph 'laid_out'). This smooths back-and-forth
// parent/child navigation. window.__layoutCacheHit reports whether the last build reused a cached layout.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
const fifo = (extra) => loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo', ...extra });
const hit = () => page.evaluate(() => window.__layoutCacheHit);

await fifo({ layoutKey: 'A' });                       // first visit to A → miss, lays out + captures
const miss1 = await hit();
await fifo({ layoutKey: 'A' });                       // revisit A → cache HIT (positions reused, ELK skipped)
const hit2 = await hit();
await fifo({ layoutKey: 'B' });                       // a different scope → miss
const miss3 = await hit();
await fifo({ layoutKey: 'A', freshLayout: true });    // Refresh A (re-elaborated) → bypass the cache
const fresh4 = await hit();
const rendered = await page.evaluate(() => !!(window.__schematic && window.__schematic.labelIndex));

console.log(JSON.stringify({ miss1, hit2, miss3, fresh4, rendered }));
const ok = report('layout_cache', [
    ['first visit: cache miss (lays out + captures)', miss1 === false],
    ['revisit same scope: cache HIT (layout reused, ELK skipped)', hit2 === true],
    ['different scope: cache miss', miss3 === false],
    ['Refresh (freshLayout) bypasses the cache', fresh4 === false],
    ['still rendered after a cache hit', rendered === true],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
