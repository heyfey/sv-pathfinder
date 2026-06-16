// Find (Ctrl+F): a search box that jumps to a signal/instance/port by name on a large schematic.
// Ctrl+F opens it, typing matches, Enter cycles, the current match is highlighted + centered, Esc
// closes.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

// Open via Ctrl+F, type a query, and report the find state.
const r = await page.evaluate(() => {
    const fire = (key, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
    const state = () => {
        const box = document.querySelector('.sv-find');
        const cur = document.querySelector('.sv-find-current');
        let curName = null;
        if (cur) {
            const id = cur.getAttribute('model-id');
            const m = id && window.__schematic.labelIndex.graph.getCell(id);
            curName = m ? (m.get('netname') || m.get('net') || m.get('label')) : null;
        }
        return { open: !!box && getComputedStyle(box).display !== 'none', count: document.querySelector('.sv-find-count')?.textContent, hasCurrent: !!cur, curName };
    };

    fire('f', { ctrlKey: true });                         // open find
    const opened = state();
    const input = document.querySelector('.sv-find-input');
    const focused = document.activeElement === input;
    input.value = 'din'; input.dispatchEvent(new Event('input'));  // search "din"
    const t0 = window.__schematic.paper.translate();
    const din = state();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); // next
    const next = state();
    const t1 = window.__schematic.paper.translate();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // close
    const closed = state();
    return { opened, focused, din, next, closed, panned: t0.tx !== t1.tx || t0.ty !== t1.ty };
});
console.log(JSON.stringify(r, null, 1));

// Re-render (step-into / new schematic resets #paper-container) must NOT break Find.
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });
const afterRerender = await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    const box = document.querySelector('.sv-find');
    const input = document.querySelector('.sv-find-input');
    return { open: !!box && getComputedStyle(box).display !== 'none', inputFocusable: !!input && document.activeElement === input };
});
console.log('after re-render:', JSON.stringify(afterRerender));

// A net drawn as several fan-out segments must be findable at EACH segment (not deduped by name).
const multi = await page.evaluate(() => {
    const segs = window.__schematic.labelIndex.graph.getLinks().filter(l => l.get('netname') === 'clk').length;
    const inp = document.querySelector('.sv-find-input'); inp.value = 'clk'; inp.dispatchEvent(new Event('input'));
    const total = parseInt((document.querySelector('.sv-find-count').textContent || '0/0').split('/')[1], 10);
    return { segs, total, soft: document.querySelectorAll('.sv-find-match').length, cur: document.querySelectorAll('.sv-find-current').length };
});
console.log('clk segments:', JSON.stringify(multi));

// The find highlight must NOT override a wire's value colour (the stroke encodes the value) — it uses
// a glow + width instead. Drive full=1 (green), find it, check the matched wire is still green.
await page.evaluate(() => window.postMessage({ type: 'setValues', updates: [{ name: 'full', values: ['1'] }] }, '*'));
await page.waitForTimeout(400);
const valColour = await page.evaluate(() => {
    const inp = document.querySelector('.sv-find-input'); inp.value = 'full'; inp.dispatchEvent(new Event('input'));
    const cur = document.querySelector('.sv-find-current');
    const line = cur && cur.querySelector('.connection');
    return { stroke: line ? getComputedStyle(line).stroke : null, hasGlow: cur ? getComputedStyle(cur).filter !== 'none' : false };
});
console.log('found valued wire:', JSON.stringify(valColour));

// Selecting a found signal must be VISIBLE — the find glow must not mask the selection glow.
const selVisible = await page.evaluate(() => {
    const cur = document.querySelector('.sv-find-current');
    if (!cur) { return { changed: false, accent: false }; }
    const before = getComputedStyle(cur).filter;
    cur.classList.add('sv-selected');                 // select the current find match
    const after = getComputedStyle(cur).filter;
    return { changed: before !== after, accent: after.includes('74, 156, 255') }; // host --sv-accent
});
console.log('select visible on found:', JSON.stringify(selVisible));

const matchCount = parseInt((r.din.count || '0/0').split('/')[1], 10);
const ok = report('find', [
    ['Ctrl+F opens the box + focuses input', r.opened.open && r.focused],
    ['query "din" finds matches', matchCount >= 1 && r.din.hasCurrent],
    ['current match is a "din" net/port', /din/i.test(r.din.curName || '')],
    ['Enter advances the match', r.next.hasCurrent && (matchCount === 1 || r.next.count !== r.din.count)],
    ['navigating pans the viewport', r.panned || matchCount === 1],
    ['Esc closes + clears highlight', !r.closed.open && !r.closed.hasCurrent],
    ['Find still works after a re-render', afterRerender.open && afterRerender.inputFocusable],
    ['every wire segment is findable (multi-segment net not deduped)', multi.segs > 1 && multi.total > multi.segs],
    ['all matches soft-highlighted, exactly one focused', multi.soft === multi.total && multi.cur === 1],
    ['find highlight keeps the wire value colour (green), adds a glow', valColour.stroke === 'rgb(47, 179, 68)' && valColour.hasGlow],
    ['selecting a found signal is visible (accent glow, not masked by find)', selVisible.changed && selVisible.accent],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
