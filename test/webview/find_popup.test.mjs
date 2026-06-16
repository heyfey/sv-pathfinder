// Per-popup Find: each subcircuit popup has its OWN find (a Find button + Ctrl+F), scoped to that
// popup's graph, independent of the main page's find. (See the reusable makeFinder.)
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'fifo.digitaljs.json', { scopePath: 'tb.u_fifo', moduleName: 'param_fifo' });

// Expand a child instance into a popup window.
await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const sub = labelIndex.graph.getElements().find(e => e.get('type') === 'Subcircuit');
    paper.trigger('open:subcircuit', sub);
});
await page.waitForTimeout(4500); // dialog opens + the popup's ELK layout settles

const r = await page.evaluate(() => {
    const content = document.querySelector('.ui-dialog-content');
    const hasFinder = !!(content && content.__svFinder);
    const findBtn = !!(content && content.querySelector('.sv-popup-find'));
    // The Find button must show the search glyph — NOT get clobbered into a zoom icon by the
    // zoom-tooltip pass that iconifies the popup's +/- buttons. (regression)
    const findIcon = content && content.querySelector('.sv-popup-find i.codicon');
    const findIsSearch = !!(findIcon && findIcon.classList.contains('codicon-search') && !findIcon.classList.contains('codicon-zoom-out'));

    // open the POPUP's find and search a net inside it
    content.__svFinder.open();
    const pinp = content.querySelector('.sv-find-input'); pinp.value = 'clk'; pinp.dispatchEvent(new Event('input'));
    const popTotal = parseInt((content.querySelector('.sv-find-count').textContent || '0/0').split('/')[1], 10);
    const popHi = !!content.querySelector('.sv-find-current');
    // The popup find box must sit BELOW the toolbar (.btn-group), not overlap its buttons. (regression)
    const popBox = content.querySelector('.sv-find');
    const bar = content.querySelector('.btn-group');
    const findBelowToolbar = !!(popBox && bar && popBox.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 1);

    // open the MAIN find (toolbar button) and search the same name — separate index, separate box
    document.getElementById('sv-find-btn').click();
    const mainBox = document.querySelector('#paper-container > .sv-find');
    const minp = mainBox.querySelector('.sv-find-input'); minp.value = 'clk'; minp.dispatchEvent(new Event('input'));
    const mainTotal = parseInt((mainBox.querySelector('.sv-find-count').textContent || '0/0').split('/')[1], 10);

    return { hasFinder, findBtn, findIsSearch, findBelowToolbar, popTotal, popHi, mainTotal, boxes: document.querySelectorAll('.sv-find').length };
});
console.log(JSON.stringify(r));

const ok = report('find_popup', [
    ['popup has its own finder + Find button', r.hasFinder && r.findBtn],
    ['popup Find button shows the search glyph (not clobbered to zoom-out)', r.findIsSearch],
    ['popup find box sits below the toolbar (does not overlap buttons)', r.findBelowToolbar],
    ['popup find matches + highlights inside the popup', r.popTotal > 0 && r.popHi],
    ['main + popup finds coexist, each its own scope', r.boxes >= 2 && r.mainTotal > 0 && r.mainTotal !== r.popTotal],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
