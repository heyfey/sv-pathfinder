// Transient change-flash (Web Animations API): nets that transition AT the marker (value array
// length>1) get a running animation on their wire line; stable nets don't; it auto-finishes; and
// repeated setValues (the live debounced-marker case) must NOT cancel it.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

const anim = () => page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const running = (name) => {
        const w = labelIndex.wires[name];
        const line = paper.findViewByModel(w).el.querySelector('.connection');
        return line && line.getAnimations ? line.getAnimations().filter(a => a.playState === 'running' || a.playState === 'paused').length : 0;
    };
    return { clk: running('clk'), din: running('din'), full: running('full'), empty: running('empty') };
});

await page.evaluate(() => window.postMessage({ type: 'setValues', updates: [
    { name: 'clk', values: ['0', '1'] },                // transition -> flash
    { name: 'din', values: ['00001111', '11110000'] },  // transition -> flash
    { name: 'full', values: ['1'] },                    // stable -> no flash
    { name: 'empty', values: ['0'] },                   // stable -> no flash
] }, '*'));
await page.waitForTimeout(150);
const mid = await anim();
await page.waitForTimeout(700);
const after = await anim();
await page.evaluate(() => { for (let i = 0; i < 3; i++) { window.postMessage({ type: 'setValues', updates: [{ name: 'clk', values: ['0', '1'] }] }, '*'); } });
await page.waitForTimeout(150);
const repeated = await anim();
console.log('mid:', JSON.stringify(mid), '| after:', JSON.stringify(after), '| repeated:', JSON.stringify(repeated));

const ok = report('flash', [
    ['transitioning clk+din animate', mid.clk >= 1 && mid.din >= 1],
    ['stable full+empty do NOT animate', mid.full === 0 && mid.empty === 0],
    ['animation auto-finishes', after.clk === 0 && after.din === 0],
    ['repeated setValues still flashes (no rAF cancel)', repeated.clk >= 1],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
