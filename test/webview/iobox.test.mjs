// Top-level IO ports render as labeled boxes (the net name sits inside the box), not the clickable
// toggle buttons digitaljs ships by default — a schematic viewer is read-only, so a button affordance
// would be misleading.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

const r = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const ios = labelIndex.graph.getElements().filter(e => e.get('type') === 'Input' || e.get('type') === 'Output');
    return ios.map(io => {
        const el = paper.findViewByModel(io).el;
        const name = el.querySelector('.ioname');
        return { net: io.get('net'), type: io.get('type'), ioname: name ? name.textContent : null, hasButton: !!el.querySelector('.btnface') };
    });
});
console.log('IO RENDERING:', JSON.stringify(r, null, 1));

const ok = report('iobox', [
    ['top-level IOs present', r.length > 0],
    ['every IO is a labeled box (net name inside)', r.every(io => io.ioname === io.net)],
    ['no clickable toggle buttons', r.every(io => !io.hasButton)],
    ['both inputs and outputs present', r.some(io => io.type === 'Input') && r.some(io => io.type === 'Output')],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
