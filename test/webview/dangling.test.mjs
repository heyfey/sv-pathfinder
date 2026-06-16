// schematicShowDanglingNets: a declared-but-unconnected net (here `dead_bus`) is synthesized by the
// converter as a stub device marked `dangling`, and the webview renders it as a labelled box tagged
// `.sv-dangling` (CSS dashes it + hides the port). The fixture is the converter's own output for the
// committed synth_dangling yosys fixture.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'dangling.digitaljs.json', { scopePath: 'tb.top', moduleName: 'top' });

const r = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const dang = labelIndex.graph.getElements().filter(e => e.get('dangling'));
    const info = dang.map(e => {
        const v = paper.findViewByModel(e);
        const b = v && v.el.getBoundingClientRect();
        const port = v && v.el.querySelector('.joint-port');
        return {
            net: e.get('net'),
            hasClass: !!(v && v.el.classList.contains('sv-dangling')),
            visible: !!(b && b.width > 0 && b.height > 0),
            portHidden: !port || getComputedStyle(port).display === 'none',
        };
    });
    return { count: dang.length, info };
});
console.log(JSON.stringify(r, null, 1));

const ok = report('dangling', [
    ['dangling stub present', r.count === 1 && r.info[0].net === 'dead_bus'],
    ['tagged .sv-dangling', r.info.every(d => d.hasClass)],
    ['rendered (visible box)', r.info.every(d => d.visible)],
    ['port magnet hidden', r.info.every(d => d.portHidden)],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
