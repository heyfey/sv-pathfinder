// Schematic webview script: hosts digitaljs (current stock, JointJS/ELK) and bridges
// to the extension. The simulation engine is constructed but NEVER started — wire
// values are driven externally from VaporView data (Spike 2 recipe).
import { Circuit, cells } from 'digitaljs';
import { Vector3vl } from '3vl';
// our overrides must come after digitaljs's own CSS (pulled in by the import above)
import './style.css';

// Make input ports non-interactive: digitaljs renders Input cells as clickable
// buttons / typable fields whose handlers toggle or set the input's own value. That's
// a *simulator* control, but this is a read-only viewer — the engine never runs, so a
// hand-set input wouldn't propagate, and it would fight the VaporView value annotation
// (two sources of truth on one wire). Neutralize the value-edit handlers; cross-nav
// (paper 'cell:pointerclick') is a separate, paper-level event and is unaffected.
// Button/NumEntry === Input and ButtonView/NumEntryView === InputView in digitaljs,
// so patching InputView covers every interactive input variant, on the main paper and
// every subcircuit popup paper (all papers share this cellViewNamespace).
cells.InputView.prototype._onButton = function () { };
cells.InputView.prototype._onNumEntry = function () { };

// Render top-level IO ports as labeled boxes showing the net name — like the ports of a
// subcircuit (the look the user asked for) — instead of interactive button / number-entry
// / lamp widgets. We must NOT force the in-subcircuit "mode 0": that flag means "this IO
// is a subcircuit boundary," and the circuit-level signal handler forwards a mode-0 IO's
// value to its enclosing subcircuit (null at top level → crash during value annotation).
// So keep digitaljs's natural mode (correct signal semantics) and change only RENDERING:
//   - swap the markup to the box+ioname (net-name) markup, whatever the mode;
//   - no-op the views' value-widget update (our markup has no button/lamp/number field);
//   - size the box to the net name (the in-subcircuit width rule).
const origIOCheckMode = cells.IO.prototype._checkMode;
cells.IO.prototype._checkMode = function () {
    const mode = origIOCheckMode.call(this); // keep correct mode + side effects
    this.set('markup', this.markupInSubcircuit);
    return mode;
};
cells.InputView.prototype._updateView = function () { };
cells.OutputView.prototype._updateView = function () { };
cells.IOView.prototype._calculateBoxWidth = function () {
    const text = this.selectors['ioname'];
    if (text && text.getAttribute('display') !== 'none') { return text.getBBox().width + 10; }
    return 20;
};

// Drop the wire hover-tools (delete-wire ✕, monitor 🔍, endpoint reconnect, reshape) —
// these are digitaljs editor/simulator affordances inappropriate for a read-only viewer
// (the ✕ deletes a wire from the schematic; the 🔍 routes to digitaljs's own waveform
// monitor, which we don't use — VaporView is the waveform). WireView.mouseenter calls
// addTools() then _addTooltip() independently, so no-opping addTools keeps the useful
// value-on-hover tooltip while removing the toolset.
cells.WireView.prototype.addTools = function () { return this; };

// Read-only viewer: don't open digitaljs's editable Memory / FSM content editors (the 🔍
// on those cells). Subcircuit 🔍 navigation is a different handler and stays.
cells.MemoryView.prototype._displayEditor = function () { };
cells.FSMView.prototype._displayEditor = function () { };

// Theme-aware wire value palette. digitaljs colors wires by signal value via the `line`
// selector attrs (hard-coded greens/reds); replace them with VS Code theme colors so the
// schematic harmonizes with the editor and VaporView. undef stays a muted neutral — most
// wires are undef when no waveform is loaded, so it must NOT be an alarm color.
function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}
function applyWireValuePalette() {
    // the signal-color table lives on the WireView (read by its _updateSignal), not the model
    cells.WireView.prototype.attrs.signal = {
        high:  { line: { stroke: cssVar('--vscode-charts-green', '#2fb344') } }, // 1
        low:   { line: { stroke: cssVar('--vscode-charts-red', '#f14c4c') } },   // 0
        def:   { line: { stroke: cssVar('--vscode-charts-blue', '#4a9cff') } },  // defined bus
        undef: { line: { stroke: cssVar('--vscode-disabledForeground', '#888888') } }, // x / no data
    };
}

const vscode = acquireVsCodeApi();

let circuit = null;
let paper = null;
let labelIndex = null;
let autoFit = true;   // auto-fit after async ELK layout until the user zooms manually
let fitTimer = null;

const paperDiv = () => document.getElementById('paper');

function post(msg) { vscode.postMessage(msg); }

// ---- value handling (Spike 2 value_encoding.md) ----
function toBinFor3vl(v, bits) {
    // Vector3vl is 3-valued; unknown chars POISON fromBin -> sanitize first.
    let s = String(v).toLowerCase().replace(/[^01x]/g, 'x');
    if (s.length < bits) { s = s.padStart(bits, '0'); }
    else if (s.length > bits) { s = s.slice(-bits); }
    return s;
}

function setWireValue(name, rawValue) {
    if (!labelIndex) { return false; }
    const wire = labelIndex.wires[name];
    if (!wire) { return false; } // renamed/aliased/hidden: non-annotatable by design
    const bits = wire.get('bits');
    const vec = Vector3vl.fromBin(toBinFor3vl(rawValue, bits), bits);
    const src = wire.get('source');
    const elem = wire.getSourceElement();
    if (elem) {
        // set on the source element: updates ALL fanout wires + port indicators
        const sigs = Object.assign({}, elem.get('outputSignals'));
        sigs[src.port] = vec;
        elem.set('outputSignals', sigs);
    } else {
        wire.set('signal', vec);
    }
    return true;
}

function clearValues() {
    if (!labelIndex || !circuit) { return; }
    for (const wire of Object.values(labelIndex.wires)) {
        const bits = wire.get('bits');
        const vec = Vector3vl.xes(bits);
        const src = wire.get('source');
        const elem = wire.getSourceElement();
        if (elem) {
            const sigs = Object.assign({}, elem.get('outputSignals'));
            sigs[src.port] = vec;
            elem.set('outputSignals', sigs);
        } else {
            wire.set('signal', vec);
        }
    }
}

// Yosys uniquifies child module names: slang emits `mod$top.path.inst`, the native
// frontend emits `$paramod\mod\PARAM=...`. Display (and report) the plain module name.
// (Keep in sync with the copy in schematic_view.ts — separate bundles.)
function cleanModuleName(celltype) {
    if (!celltype) { return celltype; }
    if (celltype.startsWith('$paramod\\')) {
        const parts = celltype.split('\\');
        return parts[1] || celltype;
    }
    const i = celltype.indexOf('$');
    return i > 0 ? celltype.slice(0, i) : celltype;
}

// retitle subcircuit box captions with the plain module name, recursively
function cleanSubcircuitCaptions(index) {
    for (const dev of Object.values(index.devices)) {
        const celltype = dev.get('celltype');
        if (celltype) {
            const clean = cleanModuleName(celltype);
            if (clean !== celltype) { dev.attr('type/text', clean); }
        }
    }
    for (const sub of Object.values(index.subcircuits)) {
        cleanSubcircuitCaptions(sub);
    }
}

// ---- cross-nav click handlers (Spike 2 source_nav.md) ----

// Hierarchical path of subcircuit instance labels enclosing a model's graph; [] for the
// top paper. Lets clicks inside child popup windows resolve against the right instance.
function graphPath(model) {
    const path = [];
    let graph = model.graph;
    while (graph) {
        const sc = graph.get('subcircuit');
        if (!sc || sc === true || typeof sc.get !== 'function' || !sc.has('label')) { break; }
        path.unshift(sc.get('label'));
        graph = sc.graph;
    }
    return path;
}

function emitClick(model) {
    const isLink = typeof model.isLink === 'function' && model.isLink();
    const celltype = model.get('celltype');
    post({
        type: 'elementClick',
        kind: isLink ? 'wire' : (celltype ? 'subcircuit' : 'device'),
        // IO port devices carry the port name in 'net' (no 'label')
        leafName: isLink ? model.get('netname') : (model.get('label') || model.get('net')),
        celltype,
        path: graphPath(model),
        sourcePositions: model.get('source_positions') || [],
        action: 'source',
    });
}

// ---- schematic load ----
function loadSchematic(msg) {
    if (circuit) {
        try { circuit.shutdown(); } catch (e) { /* ignore */ }
        circuit = null;
        paper = null;
        labelIndex = null;
    }
    document.getElementById('breadcrumb').textContent = `${msg.scopePath}  (${msg.moduleName})`;
    document.getElementById('go-parent').disabled = !msg.hasParent;
    overviewMode = msg.overview === 'minimap' ? 'minimap' : 'scrollbars'; // main-paper overview
    applyWireValuePalette(); // theme-aware value colors (re-read each load to track theme)
    setStatus('laying out schematic…');
    const container = document.getElementById('paper-container');
    container.innerHTML = '<div id="paper"></div>';

    // default windowCallback uses jquery-ui dialogs (fine inside the webview); wrap it
    // only to clean uniquified module names out of the dialog title
    circuit = new Circuit(msg.circuit, {
        layoutEngine: 'elkjs',
        windowCallback: function (type, div, closingCallback) {
            const title = div.attr('title');
            if (title) {
                div.attr('title', title.split(' ').map(cleanModuleName).join(' '));
            }
            Circuit.prototype._defaultWindowCallback.call(this, type, div, closingCallback);
        },
    });
    // 'new:paper' fires for the main paper AND each subcircuit popup paper — bind click,
    // hover, and navigation (wheel zoom/pan + drag pan) on all of them so popup windows
    // behave like the main canvas. (Registered before displayOn.)
    circuit.on('new:paper', (p) => {
        p.on('cell:pointerclick', (cellView) => emitClick(cellView.model));
        bindHover(p);
        attachNav(p);
        if (document.getElementById('paper-container').contains(p.el)) {
            setupMainPaper(p);          // main: minimap or scrollbars per setting
        } else {
            setupPopupPaper(p);         // subcircuit popup: fixed window + scrollbars
        }
    });
    paper = circuit.displayOn(paperDiv());
    labelIndex = circuit.getLabelIndex();
    cleanSubcircuitCaptions(labelIndex);
    // never start the engine — external values only
    // ELK runs asynchronously AFTER displayOn returns and applies all cell positions in
    // one batch when done. Fit once after that batch settles, then DISARM — fitting on
    // every render:done oscillates the viewport on mouse hover (hover artifacts trigger
    // render passes, and the fit itself triggers another render: feedback loop).
    autoFit = true;
    paper.once('render:done', () => { if (autoFit) { fitToView(); } });
    labelIndex.graph.on('change:position change:vertices', () => {
        if (!autoFit) { return; }
        clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
            if (autoFit) {
                fitToView();
                autoFit = false;
            }
        }, 300);
    });

    setStatus(`${Object.keys(labelIndex.wires).length} named nets, ` +
              `${Object.keys(labelIndex.devices).length} devices`);

    // debug/test handle (also used by the headless webview test)
    window.__schematic = { circuit, paper, labelIndex };
}

let baseStatus = ''; // persistent status (load / value count); hover overlays it transiently
function setStatus(text) {
    baseStatus = text;
    document.getElementById('status').textContent = text;
}

// One-line identity of a hovered model, shown in the status bar.
function describe(model) {
    if (typeof model.isLink === 'function' && model.isLink()) {
        const name = model.get('netname');
        const bits = model.get('bits') || 1;
        return name ? `net: ${name} [${bits} bit${bits > 1 ? 's' : ''}]` : `net [${bits} bit${bits > 1 ? 's' : ''}]`;
    }
    const celltype = model.get('celltype');
    if (celltype) { return `instance: ${model.get('label')} (${cleanModuleName(celltype)})`; }
    const type = model.get('type');
    if (type === 'Input' || type === 'Output') { return `port: ${model.get('net')} (${type.toLowerCase()})`; }
    return `${type}: ${model.get('label') || ''}`.trim();
}

// Hover: glow the element/wire in the accent color (CSS drop-shadow on the cell's <g>)
// and name it in the status bar. A class toggle avoids fighting the wire value colors and
// any duplicate-JointJS-instance issues with the highlighter API. Bound per paper (main +
// popups). Reuses the wire value tooltip digitaljs already shows.
let hovered = null;
function bindHover(p) {
    p.on('cell:mouseenter', (cv) => {
        if (hovered) { hovered.classList.remove('sv-hover'); }
        hovered = cv.el;
        hovered.classList.add('sv-hover');
        document.getElementById('status').textContent = describe(cv.model);
    });
    p.on('cell:mouseleave', (cv) => {
        cv.el.classList.remove('sv-hover');
        if (hovered === cv.el) { hovered = null; }
        document.getElementById('status').textContent = baseStatus;
    });
}

// ---- pan / zoom (fully transform-based) ----
// The view is driven entirely by the paper's transform (scale + translate). We do NOT use
// digitaljs's content-sizing (it resizes the SVG to the content on every render, which
// breaks transform pan/zoom and wheel-scroll range). Instead the main paper is sized to
// the container, and all navigation moves the transform. Works identically on the main
// paper and on subcircuit popup papers.

let mainResizeObs = null;
let overviewMode = 'scrollbars'; // 'scrollbars' | 'minimap' (main); from the setting per load

// Stop digitaljs from resizing a paper's SVG to its content on every render (that
// content-sizing fights transform-based pan/zoom). The paper then keeps whatever
// dimensions we set; the view is driven purely by the transform.
function neutralizeAutoResize(p) {
    p.fitToContent = function () { return this; };
}

// Fit a paper's content into a pixel size, centered, transform-only.
function fitPaper(p, w, h) {
    p.setDimensions(w, h);
    try {
        p.transformToFitContent({
            padding: 24, minScale: 0.02, maxScale: 1, useModelGeometry: true,
            verticalAlign: 'middle', horizontalAlign: 'middle',
        });
    } catch (e) {
        p.scale(1);
        p.translate(24, 24);
    }
}

// Main paper: fill the container, keep synced on resize, attach the chosen overview.
function setupMainPaper(p) {
    neutralizeAutoResize(p);
    const c = document.getElementById('paper-container');
    p.setDimensions(c.clientWidth, c.clientHeight);
    if (mainResizeObs) { mainResizeObs.disconnect(); }
    mainResizeObs = new ResizeObserver(() => {
        p.setDimensions(c.clientWidth, c.clientHeight);
        if (autoFit) { fitToView(); }
    });
    mainResizeObs.observe(c);
    if (overviewMode === 'scrollbars') { attachScrollbars(p, c); } else { attachMinimap(p, c); }
}

// Subcircuit popup paper: a fixed window sized to a fraction of the viewport (the jquery-ui
// dialog auto-sizes to the paper element), transform-based like the main paper, with
// overlay scrollbars.
function setupPopupPaper(p) {
    neutralizeAutoResize(p);
    const w = Math.min(900, Math.round(window.innerWidth * 0.7));
    const h = Math.min(600, Math.round(window.innerHeight * 0.7));
    p.setDimensions(w, h);
    const fit = () => fitPaper(p, w, h);
    p.once('render:done', fit);
    setTimeout(fit, 200); // catch async ELK layout of the child
    attachScrollbars(p, p.el);
}

// Visible region of a paper in graph-local coordinates (from transform + viewport size).
function visibleRegion(p, viewW, viewH) {
    const s = p.scale().sx, t = p.translate();
    return { x: -t.tx / s, y: -t.ty / s, w: viewW / s, h: viewH / s, s };
}

// ---- overlay scrollbars (popups; and main when the setting selects them) ----
// Thin bars over `host` that reflect and drive the paper transform. O(1) per frame; the
// content bbox is cached (recomputed lazily / after layout), so no per-pan O(N) cost.
function attachScrollbars(p, host) {
    if (getComputedStyle(host).position === 'static') { host.style.position = 'relative'; }
    const make = (cls) => {
        const bar = document.createElement('div');
        bar.className = 'sv-scrollbar ' + cls;
        const thumb = document.createElement('div');
        thumb.className = 'sv-scrollthumb';
        bar.appendChild(thumb);
        host.appendChild(bar);
        return { bar, thumb, tot: { off: 0, len: 1 } };
    };
    const hb = make('sv-h'), vb = make('sv-v');
    let area = null;
    const getArea = () => (area = area || p.getContentArea({ useModelGeometry: true }));

    function update() {
        const a = getArea();
        if (!a) { return; }
        const v = visibleRegion(p, host.clientWidth, host.clientHeight);
        const totL = Math.min(a.x, v.x), totR = Math.max(a.x + a.width, v.x + v.w);
        const totT = Math.min(a.y, v.y), totB = Math.max(a.y + a.height, v.y + v.h);
        const totW = totR - totL, totH = totB - totT;
        hb.tot = { off: totL, len: totW };
        vb.tot = { off: totT, len: totH };
        if (v.w >= totW - 1) { hb.bar.style.display = 'none'; } else {
            hb.bar.style.display = '';
            hb.thumb.style.left = ((v.x - totL) / totW * 100) + '%';
            hb.thumb.style.width = (v.w / totW * 100) + '%';
        }
        if (v.h >= totH - 1) { vb.bar.style.display = 'none'; } else {
            vb.bar.style.display = '';
            vb.thumb.style.top = ((v.y - totT) / totH * 100) + '%';
            vb.thumb.style.height = (v.h / totH * 100) + '%';
        }
    }

    const drag = (obj, axis) => obj.thumb.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const start = axis === 'x' ? e.clientX : e.clientY;
        const s = p.scale().sx, t0 = p.translate();
        const track = axis === 'x' ? obj.bar.clientWidth : obj.bar.clientHeight;
        const tot = obj.tot.len;
        const move = (ev) => {
            autoFit = false;
            const dLocal = ((axis === 'x' ? ev.clientX : ev.clientY) - start) / track * tot;
            if (axis === 'x') { p.translate(t0.tx - dLocal * s, t0.ty); }
            else { p.translate(t0.tx, t0.ty - dLocal * s); }
        };
        const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    });
    drag(hb, 'x'); drag(vb, 'y');

    p.on('transform', update);
    p.on('resize', update);
    setTimeout(() => { area = null; update(); }, 300); // after async layout settles
    update();
}

// ---- minimap (main paper only) ----
// A small canvas overview in the corner. The structural overview (one rect per cell) is
// drawn ONCE to an offscreen canvas; per pan/zoom only the viewport rectangle redraws, so
// it stays cheap on large designs and value scrubbing never touches it.
function attachMinimap(p, host) {
    const MW = 200, MH = 150;
    const canvas = document.createElement('canvas');
    canvas.id = 'sv-minimap';
    canvas.width = MW; canvas.height = MH;
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let overview = null, area = null, mscale = 1, offX = 0, offY = 0;

    function build() {
        area = p.getContentArea({ useModelGeometry: true });
        if (!area || !area.width) { return false; }
        const pad = 6;
        mscale = Math.min((MW - 2 * pad) / area.width, (MH - 2 * pad) / area.height);
        offX = pad - area.x * mscale + (MW - 2 * pad - area.width * mscale) / 2;
        offY = pad - area.y * mscale + (MH - 2 * pad - area.height * mscale) / 2;
        overview = document.createElement('canvas'); overview.width = MW; overview.height = MH;
        const o = overview.getContext('2d');
        const accent = cssVar('--sv-accent', '#4a9cff');
        const neutral = cssVar('--vscode-editorWidget-border', '#888888');
        for (const el of p.model.getElements()) {
            const b = el.getBBox();
            o.fillStyle = el.get('type') === 'Subcircuit' ? accent : neutral;
            o.globalAlpha = el.get('type') === 'Subcircuit' ? 0.55 : 0.3;
            o.fillRect(b.x * mscale + offX, b.y * mscale + offY,
                Math.max(1, b.width * mscale), Math.max(1, b.height * mscale));
        }
        o.globalAlpha = 1;
        return true;
    }
    function draw() {
        if (!overview && !build()) { return; }
        ctx.fillStyle = cssVar('--vscode-editorWidget-background', '#252526');
        ctx.fillRect(0, 0, MW, MH);
        ctx.drawImage(overview, 0, 0);
        // viewport rectangle (outline only — a fill washes the whole minimap when zoomed
        // out on a large design). Dim the area OUTSIDE the viewport instead, so the visible
        // region reads as the bright part.
        const v = visibleRegion(p, host.clientWidth, host.clientHeight);
        const rx = Math.max(0, v.x * mscale + offX), ry = Math.max(0, v.y * mscale + offY);
        const rw = Math.min(MW, v.x * mscale + offX + v.w * mscale) - rx;
        const rh = Math.min(MH, v.y * mscale + offY + v.h * mscale) - ry;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, MW, ry);                       // above
        ctx.fillRect(0, ry + rh, MW, MH - (ry + rh));     // below
        ctx.fillRect(0, ry, rx, rh);                      // left
        ctx.fillRect(rx + rw, ry, MW - (rx + rw), rh);    // right
        ctx.strokeStyle = cssVar('--sv-accent', '#4a9cff');
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);
    }
    function recenter(ev) {
        const r = canvas.getBoundingClientRect();
        const lx = (ev.clientX - r.left - offX) / mscale;
        const ly = (ev.clientY - r.top - offY) / mscale;
        const s = p.scale().sx;
        autoFit = false;
        p.translate(host.clientWidth / 2 - lx * s, host.clientHeight / 2 - ly * s);
    }
    canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault(); recenter(e);
        const move = (ev) => recenter(ev);
        const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    });
    p.on('transform', draw);
    setTimeout(() => { overview = null; draw(); }, 300); // rebuild after async layout
    draw();
}

// Scale a paper around a client point, keeping that point fixed under the cursor.
function zoomAround(p, factor, clientX, clientY) {
    autoFit = false;
    const s0 = p.scale().sx;
    const s1 = Math.min(Math.max(s0 * factor, 0.02), 10);
    if (s1 === s0) { return; }
    const rect = p.el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const t = p.translate();
    const lx = (px - t.tx) / s0; // graph-local point under the cursor
    const ly = (py - t.ty) / s0;
    p.scale(s1);
    p.translate(px - lx * s1, py - ly * s1);
}

// Wheel + drag navigation, attached to every paper (main + popups):
//   ctrl+wheel  -> zoom around the cursor
//   plain wheel -> pan (scroll up/down; shift = left/right; trackpads use deltaX directly)
//   drag blank  -> pan (cell drags still move the cell)
function attachNav(p) {
    p.el.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
            zoomAround(p, e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
        } else {
            autoFit = false;
            let dx = e.deltaX, dy = e.deltaY;
            if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
            const t = p.translate();
            p.translate(t.tx - dx, t.ty - dy);
        }
    }, { passive: false });

    let panning = false, startX = 0, startY = 0, startT = null;
    p.on('blank:pointerdown', (evt) => {
        panning = true;
        autoFit = false;
        startX = evt.clientX;
        startY = evt.clientY;
        startT = p.translate();
        p.el.style.cursor = 'grabbing';
    });
    document.addEventListener('pointermove', (evt) => {
        if (!panning) { return; }
        p.translate(startT.tx + (evt.clientX - startX), startT.ty + (evt.clientY - startY));
    });
    document.addEventListener('pointerup', () => {
        if (!panning) { return; }
        panning = false;
        p.el.style.cursor = '';
    });
}

// Fit content into the (container-sized) main paper by adjusting the transform only.
function fitToView() {
    if (!paper) { return; }
    const c = document.getElementById('paper-container');
    fitPaper(paper, c.clientWidth, c.clientHeight);
}

// Toolbar zoom buttons: zoom the main paper around the viewport center.
function zoomBy(factor) {
    if (!paper) { return; }
    const r = document.getElementById('paper-container').getBoundingClientRect();
    zoomAround(paper, factor, r.left + r.width / 2, r.top + r.height / 2);
}

document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.25));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(0.8));
document.getElementById('zoom-fit').addEventListener('click', fitToView);
document.getElementById('refresh').addEventListener('click', () => post({ type: 'refresh' }));
document.getElementById('go-parent').addEventListener('click', () => post({ type: 'goToParent' }));
const presetButton = document.getElementById('preset-toggle');
presetButton.addEventListener('click', () => {
    const next = presetButton.textContent === 'RTL' ? 'GLS' : 'RTL';
    presetButton.textContent = next;
    post({ type: 'setPreset', preset: next.toLowerCase() });
});

// ---- messages from the extension ----
window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
        case 'loadSchematic':
            try {
                loadSchematic(msg);
            } catch (e) {
                setStatus('Failed to render schematic: ' + (e && e.message ? e.message : e));
                console.error(e);
            }
            break;
        case 'setValues': {
            if (!circuit) { break; }
            let applied = 0;
            for (const u of msg.updates) {
                if (setWireValue(u.name, u.value)) { applied++; }
            }
            setStatus(`values @ cursor: ${applied}/${msg.updates.length} nets annotated`);
            break;
        }
        case 'clearValues':
            clearValues();
            setStatus('values cleared');
            break;
    }
});

post({ type: 'ready' });
