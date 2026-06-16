// inout bidirectional rendering. The synthetic fixture is two instances (u_a, u_b) of a module
// with an `inout [3:0] bus`, wired together. The converter gives the otherwise-sourceless inout net
// a nominal source so a wire draws, and tags the bus ports bidirectional → a ⇄ glyph.
import { launchPage, loadSchematic, report } from './helpers.mjs';

const { browser, page, logs } = await launchPage();
await loadSchematic(page, 'inout.digitaljs.json', { scopePath: 'tb', moduleName: 'tb' });

const r = await page.evaluate(() => {
    const { paper, labelIndex } = window.__schematic;
    const g = labelIndex.graph;
    const busLinks = g.getLinks().filter(l => l.get('netname') === 'bus');
    const subs = g.getElements().filter(e => e.get('type') === 'Subcircuit');
    const glyphs = [];
    for (const s of subs) {
        const v = paper.findViewByModel(s);
        if (!v) { continue; }
        const nodes = [...v.el.querySelectorAll('text.portbidir')].filter(n => n.textContent === '⇄' && getComputedStyle(n).display !== 'none');
        if (nodes.length) { glyphs.push({ label: s.get('label'), bidirPorts: nodes.length }); }
    }
    return { busLinkCount: busLinks.length, subs: subs.map(s => s.get('label')), glyphs };
});
console.log(JSON.stringify(r, null, 1));

const ok = report('inout', [
    ['inout bus draws a wire (link netname=bus)', r.busLinkCount >= 1],
    ['both inout instances present', r.subs.includes('u_a') && r.subs.includes('u_b')],
    ['bidirectional ⇄ glyph on inout ports', r.glyphs.length >= 1 && r.glyphs.some(x => x.bidirPorts >= 1)],
    ['no page errors', !logs.some(l => l.startsWith('PAGEERROR'))],
], logs);
await browser.close();
process.exit(ok ? 0 : 1);
