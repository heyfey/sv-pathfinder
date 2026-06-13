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
    // 'new:paper' fires for the main paper AND each subcircuit popup paper — bind the
    // cross-nav click handler on all of them (must be registered before displayOn).
    circuit.on('new:paper', (p) => {
        p.on('cell:pointerclick', (cellView) => emitClick(cellView.model));
        bindHover(p);
    });
    paper = circuit.displayOn(paperDiv());
    labelIndex = circuit.getLabelIndex();
    cleanSubcircuitCaptions(labelIndex);
    attachPan(paper); // drag blank canvas to pan
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

// ---- toolbar ----
function zoomBy(factor) {
    if (!paper) { return; }
    autoFit = false;
    const s = Math.min(Math.max(paper.scale().sx * factor, 0.05), 10);
    paper.scale(s);
    paper.fitToContent({ padding: 30, allowNewOrigin: 'any' });
}

function fitToView() {
    if (!paper) { return; }
    const container = document.getElementById('paper-container');
    try {
        paper.transformToFitContent({
            padding: 20,
            minScale: 0.05,
            maxScale: 1,
            fittingBBox: { x: 0, y: 0, width: container.clientWidth, height: container.clientHeight },
        });
    } catch (e) {
        // older JointJS without transformToFitContent: fall back to 1:1
        paper.scale(1);
    }
    // digitaljs re-runs fitToContent({padding: 30}) on EVERY render:done (hover included);
    // end with the identical call so those refits are idempotent and the view never jumps.
    paper.fitToContent({ padding: 30, allowNewOrigin: 'any' });
}

// Zoom keeping the point under the cursor fixed (ctrl+wheel). Unlike zoomBy, this does NOT
// refit — it scales then translates so the local point beneath (clientX, clientY) stays put.
function zoomAround(factor, clientX, clientY) {
    if (!paper) { return; }
    autoFit = false;
    const s0 = paper.scale().sx;
    const s1 = Math.min(Math.max(s0 * factor, 0.05), 10);
    if (s1 === s0) { return; }
    const rect = paperDiv().getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const t = paper.translate();
    const lx = (px - t.tx) / s0; // graph-local point under the cursor
    const ly = (py - t.ty) / s0;
    paper.scale(s1);
    paper.translate(px - lx * s1, py - ly * s1);
}

// Drag the blank canvas to pan (cell drags still move the cell). Attached per paper.
function attachPan(p) {
    let panning = false;
    let startX = 0, startY = 0, startT = null;
    p.on('blank:pointerdown', (evt) => {
        panning = true;
        autoFit = false;
        startX = evt.clientX;
        startY = evt.clientY;
        startT = p.translate();
        p.el.style.cursor = 'grabbing';
    });
    const move = (evt) => {
        if (!panning) { return; }
        p.translate(startT.tx + (evt.clientX - startX), startT.ty + (evt.clientY - startY));
    };
    const up = () => {
        if (!panning) { return; }
        panning = false;
        p.el.style.cursor = '';
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
}

document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.25));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(0.8));
document.getElementById('zoom-fit').addEventListener('click', fitToView);
// ctrl+wheel zooms around the cursor; plain wheel keeps native container scrolling
document.getElementById('paper-container').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) { return; }
    e.preventDefault();
    zoomAround(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
}, { passive: false });
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
