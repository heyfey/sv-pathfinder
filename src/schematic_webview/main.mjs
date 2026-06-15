// Schematic webview script: hosts digitaljs (current stock, JointJS/ELK) and bridges
// to the extension. The simulation engine is constructed but NEVER started — wire
// values are driven externally from VaporView data (Spike 2 recipe).
import { Circuit, cells } from 'digitaljs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Vector3vl } from '3vl';
// our overrides must come after digitaljs's own CSS (pulled in by the import above)
import './style.css';
import '@vscode/codicons/dist/codicon.css'; // VS Code's official icon font (bundled as a data-url)

// Layout density tiers (user setting `schematicSpacing`). One table drives everything that
// affects crowding: ELK block/edge spacing, the clearance reserved around each wire's
// net-name label, and the box padding that decides whether port/signal names fit inside a
// block. `compact` is the default (tightest, smallest canvas); roomier tiers trade size for
// legibility. The active tier is chosen per load from the message; the prototype patches
// below read `spacing` at render time, so changing the setting + reloading is enough.
//   boxGap  — clearance between a block's left-side and right-side port labels (digitaljs
//             hard-codes 25, which lets long names collide in the middle).
//   ioPad   — horizontal padding inside a top-level IO box so its name doesn't touch the edge.
//   netChannel — how much of each net-name label's width ELK reserves as a clear lane on the
//             wire (0..1). The reserved lane plus the betweenLayers margins on both sides set
//             the minimum wire length, so this is the main lever on how long/empty wires look.
//             compact reserves little (short wires; a label may sit closer to a box); roomier
//             tiers reserve the full label so names never touch a box.
// VALUE ANNOTATION: values render UNDER the name, not beside it — so the reserved room grows
// VERTICALLY, not horizontally. Reserve it here up front (never resize at runtime, which would
// force a re-layout): bump `labelH` for a value line under each wire net-name; for child-instance
// boxes, reserve a value line under EACH port name via `rowH` — the per-port row pitch (digitaljs's
// Subcircuit hard-codes 16px/row in cells/subcircuit.js; we override it to rowH so the value line
// fits). Widths stay name-driven; only heights change, so runtime value updates are pure text swaps.
//   rowH — child-instance per-port row pitch; must clear a name line + a value line under it.
//   valueH — extra channel height reserved under each wire net-name for its value line, so 2-line
//            wire labels (name over value) don't crowd parallel labeled wires.
const SPACING = {
    compact:     { nodeNode: 24, betweenLayers: 36, edgeNode: 12, edgeEdge: 10, edgeLabel: 3, labelPad: 6,  labelH: 14, boxGap: 56, ioPad: 26, netChannel: 0.5,  rowH: 26, valueH: 9 },
    comfortable: { nodeNode: 34, betweenLayers: 56, edgeNode: 22, edgeEdge: 16, edgeLabel: 4, labelPad: 14, labelH: 16, boxGap: 70, ioPad: 34, netChannel: 0.85, rowH: 28, valueH: 10 },
    spacious:    { nodeNode: 44, betweenLayers: 80, edgeNode: 30, edgeEdge: 24, edgeLabel: 5, labelPad: 24, labelH: 18, boxGap: 84, ioPad: 42, netChannel: 1.0,  rowH: 30, valueH: 11 },
};
let spacing = SPACING.compact;

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
    // Estimate from the model net name (textWidth), not the DOM: at sizing time the paper is
    // frozen so the text isn't laid out (getBBox ~0). estimate = name*charPx + tier padding.
    const net = this.model.get('net') || '';
    return net ? Math.ceil(boxTextWidth(net)) + spacing.ioPad : 20;
};

// Size child-instance (and dff/fsm/memory) boxes to fit their port-name labels. digitaljs's
// version (leftLabelMax + rightLabelMax + 25) measures labels with getBBox() during the
// frozen initial render — the text isn't laid out then, so it reads ~0 and the box locks too
// narrow, letting long left/right port names collide in the middle (the screenshot bug). We
// estimate from the MODEL ports (label = port.portlabel ?? port.id) with textWidth instead —
// no layout needed, so it's right while the paper is still frozen — and use a tier-scaled
// middle gap (boxGap), with headroom for in-box values later.
cells.BoxView.prototype._calculateBoxWidth = function () {
    let lw = -5, rw = -5; // digitaljs's empty-side fixup
    for (const p of this.model.getPorts()) {
        if (!p.labelled) { continue; }
        const w = boxTextWidth('portlabel' in p ? p.portlabel : p.id);
        if (p.group === 'out') { rw = Math.max(rw, w); } else if (p.group === 'in') { lw = Math.max(lw, w); }
    }
    return Math.ceil(lw + rw) + spacing.boxGap;
};

// Per-port value annotation on child-instance (Subcircuit) boxes. digitaljs draws only the port
// NAME (the `iolabel` text) and packs ports at 16px/row. To show each port's live VaporView value
// UNDER its name we (a) add a second text element `iovalue` to the port markup, (b) re-pitch the
// box to spacing.rowH/row so the value line has room WITHOUT a runtime resize (reserve up front —
// a resize would force a full re-layout), and (c) drive the value text from the SAME reactive
// signal path that already colors the port circles (the _updatePortSignals override below).
// Scoped to Subcircuit so plain gates/dffs are untouched. Widths stay name-driven (hex values are
// short); a value wider than its port name can encroach on the middle gap — acceptable for now.
cells.Subcircuit.prototype.portMarkup = cells.Gate.prototype.portMarkup.concat([
    { tagName: 'text', className: 'iovalue', selector: 'iovalue' },
]);
const _origSubPreprocess = cells.Subcircuit.prototype._preprocessPorts;
cells.Subcircuit.prototype._preprocessPorts = function (ports) {
    _origSubPreprocess.call(this, ports); // sets each port's bits + iolabel (name) attrs
    for (const port of ports) {
        const isOut = port.group === 'out';
        // place the value directly under the name (iolabel sits at the port centre): same side
        // anchor as the name, nudged down a line. Styling (size/colour) is in style.css (.iovalue).
        (port.attrs = port.attrs || {})['iovalue'] = {
            text: '', refX: isOut ? -5 : 5, refY: 9,
            textAnchor: isOut ? 'end' : 'start', textVerticalAnchor: 'middle',
        };
    }
};
const _origSubInitialize = cells.Subcircuit.prototype.initialize;
cells.Subcircuit.prototype.initialize = function () {
    _origSubInitialize.apply(this, arguments); // builds ports + sets the 16px/row size
    // re-pitch to spacing.rowH/row so a value line fits under each port name (mirrors the
    // vcount*16+8 rule in cells/subcircuit.js, but with our taller pitch). Width is left to
    // BoxView._autoResizeBox / _calculateBoxWidth.
    const items = (this.get('ports') || {}).items || [];
    let ins = 0, outs = 0;
    for (const p of items) { if (p.group === 'out') { outs++; } else { ins++; } }
    const vcount = Math.max(ins, outs);
    if (vcount > 0) {
        const sz = this.size();
        this.set('size', { width: sz.width, height: vcount * spacing.rowH + 8 });
    }
};
// Feed per-port value text from the reactive signal path. digitaljs's Circuit binds
// change:outputSignals -> fan-out wire signal -> target._setInput -> inputSignals at the MODEL
// level (circuit.js, independent of the never-started engine), so our VaporView annotation
// (setWireValue) already propagates a value onto every subcircuit port. GateView._updatePortSignals
// recolours the port circle on each such change; we extend it to also write the formatted value
// under the name. View-only (set textContent on the cached port node) — no model mutation, so no
// re-entrancy and no extra layout, exactly like the existing wire-colour path.
const _origUpdatePortSignals = cells.GateView.prototype._updatePortSignals;
cells.SubcircuitView.prototype._updatePortSignals = function (dir) {
    _origUpdatePortSignals.apply(this, arguments);
    const m = this.model;
    const sigs = dir === 'in' ? m.get('inputSignals')
        : dir === 'out' ? m.get('outputSignals')
        : Object.assign({}, m.get('inputSignals'), m.get('outputSignals'));
    for (const port in sigs) {
        const cache = this._portElementsCache[port];
        const node = cache && cache.portSelectors && cache.portSelectors.iovalue;
        if (!node) { continue; }
        const t = formatSig(sigs[port]);
        node.textContent = t;
        // JointJS hides a text node whose `text` attr is empty (display:none); we set textContent
        // directly, so force display back on when there's a value (and off when blank).
        node.style.display = t ? 'inline' : 'none';
    }
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

// ELK layout: roomier spacing + reserve a clear channel for each wire's net-name label.
// digitaljs feeds ELK a tight, fixed option set (lib/elkjs.js) and never tells it about the
// net-name labels it draws at every wire's midpoint — so on dense levels boxes pack
// together and those labels collide with box edges and with one another. We can't reach
// digitaljs's private to_elkjs(), but (a) every Wire carries its netname at construction and
// (b) every layout runs through ELK.layout(elkGraph). So: record each wire's label size by
// id, and just before ELK runs, widen the spacing and attach each edge's label so ELK
// reserves room for it. digitaljs still draws the label itself (we ignore ELK's label
// position); we only buy it space. This is the readability fix for crowding/label overlap.
// Value annotation shows the value UNDER the net-name, so the channel also grows vertically by
// `valueH` (a second line); width stays the name, so wires don't get longer.
const _wireLabelDims = new Map(); // wire/link id -> { width, height, text }
// Reserved size of the channel ELK keeps clear for a net-name label. width = estimated text
// width (textWidth) + tier side padding; height drives how far ELK spreads parallel labeled
// wires apart. Computed at Wire construction (no DOM yet), so it uses the textWidth estimate.
// height = name line (labelH) + value line (valueH), reserved up front so live value updates are
// pure text swaps that never trigger a re-layout.
function netLabelDims(text) {
    // Reserve only `netChannel` of the label width so compact tiers keep wires short; ELK
    // still inserts a lane (≥ this) that the betweenLayers margins pad out from the boxes.
    const w = textWidth(text) * spacing.netChannel + spacing.labelPad;
    return { width: Math.max(1, Math.ceil(w)), height: spacing.labelH + spacing.valueH, text };
}
const _origWireInit = cells.Wire.prototype.initialize;
cells.Wire.prototype.initialize = function () {
    _origWireInit.apply(this, arguments);
    const nm = this.get('netname');
    if (!nm) { return; }
    _wireLabelDims.set(this.id, netLabelDims(nm));
    // digitaljs gave this wire a single-line netname label; replace it with a two-line label so
    // the live value can sit UNDER the name (vertical growth, no extra wire length). The name is
    // lifted just above the wire and the value sits just below it; WireView._updateSignal fills
    // the value text on each signal change (below). Blank value line when there's no waveform.
    this.label(0, {
        markup: [
            { tagName: 'text', selector: 'label', className: 'label' },
            { tagName: 'text', selector: 'labelvalue', className: 'wirevalue' },
        ],
        attrs: {
            label: { text: nm, fontSize: '8pt', textAnchor: 'middle', textVerticalAnchor: 'middle', y: -4 },
            labelvalue: { text: '', textAnchor: 'middle', textVerticalAnchor: 'middle', y: 7 },
        },
        position: { distance: 0.5 },
    });
};
// Fill the per-wire value line from the reactive signal path. digitaljs's WireView recolors the
// line on each change:signal (confirmUpdate -> _updateSignal); we extend it to also write the
// formatted value under the net name. View-only (textContent on the label's value node) — no
// model mutation, no layout — the same approach as the child-instance port values.
const _origWireUpdateSignal = cells.WireView.prototype._updateSignal;
cells.WireView.prototype._updateSignal = function () {
    _origWireUpdateSignal.apply(this, arguments);
    const node = this.el.querySelector('.wirevalue');
    if (!node) { return; }
    const t = formatSig(this.model.get('signal'));
    node.textContent = t;
    // JointJS hides an empty-text node (display:none); force it back on when there's a value.
    node.style.display = t ? 'inline' : 'none';
};
const _origElkLayout = ELK.prototype.layout;
ELK.prototype.layout = function (graph, opts) {
    // only touch digitaljs's schematic graphs (the 'root' graph with the props it sets)
    if (graph && graph.id === 'root' && graph.properties && Array.isArray(graph.edges)) {
        Object.assign(graph.properties, {
            'elk.spacing.nodeNode': spacing.nodeNode,                       // siblings within a column (ELK default 20)
            'elk.layered.spacing.nodeNodeBetweenLayers': spacing.betweenLayers, // column gap (digitaljs default 40)
            'elk.spacing.edgeNode': spacing.edgeNode,                       // wire-to-box clearance
            'elk.spacing.edgeEdge': spacing.edgeEdge,
            'elk.layered.spacing.edgeNodeBetweenLayers': spacing.edgeNode,
            'elk.layered.spacing.edgeEdgeBetweenLayers': spacing.edgeEdge,
            'org.eclipse.elk.edgeLabels.inline': true,        // labels sit on the wire, as digitaljs draws them
            'elk.spacing.edgeLabel': spacing.edgeLabel,
        });
        for (const e of graph.edges) {
            if (e.labels) { continue; }
            const d = _wireLabelDims.get(e.id);
            if (d) { e.labels = [{ id: e.id + ':netlabel', text: d.text, width: d.width, height: d.height }]; }
        }
    }
    return _origElkLayout.call(this, graph, opts);
};

// Per-character advance used to size boxes/labels BEFORE layout. Boxes must be sized while
// digitaljs lays the graph out, but that happens with the paper frozen — the label text
// isn't laid out yet, so getBBox reads ~0 (the box-too-small bug). We can't measure then, so
// we estimate width = textLength * charPx (labels render in a fixed-width font). This makes
// digitaljs's single layout already account for the box size — no second pass, and it can't
// break (if the estimate is off a box is just slightly tight/loose). charPx starts at the
// 8pt-monospace advance (~0.6em) and self-calibrates to the user's actual editor font from
// the first real labels (see calibrateCharPx), so popups and later renders track it exactly.
let charPx = 6.6;
const textWidth = (s) => (s ? String(s).length : 0) * charPx;
// Boxes reserve more than the bare text so port/instance names sit inside with margin (and
// to stay safe when the font is wider than the estimate). Applied to box sizing only — NOT to
// the net-name channel, so wires don't get longer.
const BOX_TEXT_FUDGE = 1.3;
const boxTextWidth = (s) => textWidth(s) * BOX_TEXT_FUDGE;
// After a paper unfreezes, real label geometry is valid — measure a few labels once to learn
// this environment's per-char advance, so subsequent layouts (popups, reloads) size exactly.
let _calibrated = false;
function calibrateCharPx(paper) {
    if (_calibrated) { return; }
    let sumW = 0, sumN = 0;
    for (const el of paper.el.querySelectorAll('text.iolabel, .joint-link text.label')) {
        const n = (el.textContent || '').length;
        if (n >= 3) { const w = el.getBBox().width; if (w > 0) { sumW += w; sumN += n; } }
    }
    if (sumN > 0) { charPx = sumW / sumN; _calibrated = true; }
}

// Open a child instance in a popup ("Expand"). At most one popup per instance: if one's
// already open, raise it instead of duplicating. The key is the dialog title digitaljs uses
// (celltype + ' ' + label); open/close is tracked in the windowCallback wrapper below.
// Also stash a breadcrumb-style title (full hierarchical instance path + module name) so the
// popup titlebar matches the main page, instead of digitaljs's raw "celltype label".
const _openSubKeys = new Set();     // instance keys with an open popup
const _openSubDialogs = new Map();  // key -> jquery-ui dialog div (to raise on re-click)
const _subTitles = new Map();       // key -> "full.hier.path  (module)" for the titlebar
const _subShort = new Map();        // key -> short instance label (for the taskbar tab)
function openSubcircuit(model, paper) {
    const key = model.get('celltype') + ' ' + model.get('label');
    if (_openSubKeys.has(key)) { restorePopup(key); return; } // already open → restore + raise
    const hier = [currentScopePath, ...graphPath(model), model.get('label')].filter(Boolean).join('.');
    _subTitles.set(key, `${hier}  (${cleanModuleName(model.get('celltype'))})`);
    _subShort.set(key, model.get('label'));
    _openSubKeys.add(key);                            // mark before trigger (guards fast double-clicks)
    paper.trigger('open:subcircuit', model);
}
// digitaljs opens the popup from the subcircuit's zoom (🔍) icon; route it through our helper.
cells.SubcircuitView.prototype.zoomInCircuit = function (evt) {
    evt.stopPropagation();
    openSubcircuit(this.model, this.paper);
    return false;
};

// ---- popup taskbar + minimize ----
// A row of tabs along the bottom (one per open popup) for quickly switching between many
// child windows, plus a minimize button in each dialog titlebar. Tabs raise (and restore) the
// popup; minimize hides it but keeps its tab. State is keyed by the same per-instance key.
const _taskbarTabs = new Map();  // key -> tab element
const _subMinimized = new Set(); // keys whose popup is currently minimized
let _taskbarEl = null;
let _mainTab = null;
function taskbar() {
    if (!_mainTab) {
        _taskbarEl = document.getElementById('sv-taskbar'); // lives at the left of the status bar
        // the main-page tab is always first and can't be minimized — a quick way to surface
        // the main schematic (minimizes every open popup so nothing covers it).
        _mainTab = document.createElement('div');
        _mainTab.className = 'sv-tab sv-tab-main';
        _mainTab.innerHTML = '<i class="codicon codicon-home"></i><span class="sv-tab-name"></span>';
        _mainTab.querySelector('.sv-tab-name').textContent = currentMainName || 'main';
        _mainTab.title = 'Show the main schematic (minimize all popups)';
        _mainTab.addEventListener('click', focusMain);
        _taskbarEl.appendChild(_mainTab);
    }
    return _taskbarEl;
}
function refreshTaskbar() { if (_taskbarEl) { _taskbarEl.style.display = _taskbarTabs.size ? 'flex' : 'none'; } }
function dialogWidget(key) {
    const div = _openSubDialogs.get(key);
    try { return div ? div.dialog('widget') : null; } catch (e) { return null; }
}
// Key of the visible popup currently on top (highest jquery-ui z-index), or null.
function topmostPopupKey() {
    let top = null, topZ = -1;
    for (const key of _openSubKeys) {
        if (_subMinimized.has(key)) { continue; }
        const w = dialogWidget(key);
        if (!w) { continue; }
        const z = parseInt(getComputedStyle(w.get(0)).zIndex, 10) || 0;
        if (z >= topZ) { topZ = z; top = key; }
    }
    return top;
}
function restorePopup(key) {
    if (_subMinimized.has(key)) {
        _subMinimized.delete(key);
        const w = dialogWidget(key); if (w) { w.show(); }
        const tab = _taskbarTabs.get(key); if (tab) { tab.classList.remove('sv-min'); }
    }
    const div = _openSubDialogs.get(key);
    if (div) { try { div.dialog('moveToTop'); } catch (e) { /* not ready */ } }
}
function minimizePopup(key) {
    const w = dialogWidget(key); if (!w) { return; }
    _subMinimized.add(key); w.hide();
    const tab = _taskbarTabs.get(key); if (tab) { tab.classList.add('sv-min'); }
}
// Windows-style tab click: minimized → restore+raise; on top (active) → minimize; else raise.
function onPopupTabClick(key) {
    if (_subMinimized.has(key)) { restorePopup(key); }
    else if (key === topmostPopupKey()) { minimizePopup(key); }
    else { restorePopup(key); }
}
function focusMain() {
    for (const key of _openSubKeys) { if (!_subMinimized.has(key)) { minimizePopup(key); } }
}
function addTaskbarTab(key) {
    if (_taskbarTabs.has(key)) { return; }
    const tab = document.createElement('div');
    tab.className = 'sv-tab';
    tab.textContent = _subShort.get(key) || cleanModuleName((key.split(' ')[0] || ''));
    tab.title = _subTitles.get(key) || key;
    tab.addEventListener('click', () => onPopupTabClick(key));
    taskbar().appendChild(tab);
    _taskbarTabs.set(key, tab);
    refreshTaskbar();
}
function removeTaskbarTab(key) {
    const tab = _taskbarTabs.get(key);
    if (tab) { tab.remove(); _taskbarTabs.delete(key); }
    _subMinimized.delete(key);
    refreshTaskbar();
}
// Add a "minimize" button to the dialog titlebar, left of jquery-ui's close button — and
// re-skin jquery-ui's close button with the matching codicon (drop its sprite icon + label).
function addMinimizeButton(div, key) {
    let titlebar;
    try { titlebar = div.dialog('widget').find('.ui-dialog-titlebar').get(0); } catch (e) { return; }
    if (!titlebar || titlebar.querySelector('.sv-min-btn')) { return; }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sv-min-btn'; btn.title = 'Minimize';
    btn.innerHTML = '<i class="codicon codicon-chrome-minimize"></i>';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); minimizePopup(key); });
    const close = titlebar.querySelector('.ui-dialog-titlebar-close');
    if (close) { close.replaceChildren(); close.innerHTML = '<i class="codicon codicon-chrome-close"></i>'; titlebar.insertBefore(btn, close); } else { titlebar.appendChild(btn); }
}
// digitaljs's subcircuit zoom buttons (– / +): give them codicon icons + tooltips.
function addZoomTooltips(div) {
    const root = div && div.get ? div.get(0) : null;
    if (!root) { return; }
    for (const b of root.querySelectorAll('.btn-group .btn')) {
        const zin = (b.textContent || '').trim() === '+';
        b.title = zin ? 'Zoom in' : 'Zoom out';
        b.innerHTML = `<i class="codicon codicon-zoom-${zin ? 'in' : 'out'}"></i>`;
    }
}
// Add an export (⤓) button to the popup's button group so this child view can be exported too.
function addPopupExport(div) {
    const root = div && div.get ? div.get(0) : null;
    if (!root) { return; }
    const group = root.querySelector('.btn-group');
    const p = root.__svPaper;
    if (!group || !p || group.querySelector('.sv-popup-export')) { return; }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary sv-popup-export';
    btn.title = 'Export this view (SVG / PNG / JSON)';
    btn.innerHTML = '<i class="codicon codicon-export"></i>';
    btn.addEventListener('click', () => { _exportPaper = p; post({ type: 'export', name: paperHierName(p) }); });
    group.appendChild(btn);
}
function clearTaskbar() {
    for (const tab of _taskbarTabs.values()) { tab.remove(); }
    _taskbarTabs.clear(); _subMinimized.clear(); _subShort.clear();
    refreshTaskbar();
}
// Confine a popup to the canvas area (#paper-container, between the toolbar and the status
// bar) so it can't be dragged or resized over the status bar — the status bar sits above the
// dialogs (z-index) to keep its tabs clickable, so an overlapping popup gets clipped by it.
function constrainDialog(div) {
    const pc = document.getElementById('paper-container');
    try {
        const widget = div.dialog('widget');
        try { widget.draggable('option', 'containment', pc); } catch (e) { /* not draggable */ }
        try { widget.resizable('option', 'containment', pc); } catch (e) { /* not resizable */ }
        div.dialog('option', { maxWidth: pc.clientWidth, maxHeight: pc.clientHeight });
    } catch (e) { /* dialog not ready */ }
}

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
let currentScopePath = ''; // breadcrumb root for this render; used to build popup hier titles
let currentMainName = '';  // main module name (label for the always-present main taskbar tab)
// Read-only interactivity: disable every editing action (drag a node, start a wire from a
// port magnet, move/add/remove a wire's vertices or endpoints) while KEEPING pointer events,
// so click-to-highlight and the right-click menu still work on wires, ports, and instances.
const READONLY = {
    elementMove: false, addLinkFromMagnet: false, arrowheadMove: false,
    vertexAdd: false, vertexMove: false, vertexRemove: false,
    linkMove: false, labelMove: false, useLinkTools: false,
};

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

// Caption a child-instance box as two centered lines ABOVE it:
//     instance name          (digitaljs's `label`, normally at the bottom)
//     (module name)          (digitaljs's `type` = celltype, normally the only top line)
// digitaljs stacks module-on-top / instance-on-bottom; we want instance-on-top with the
// module under it in parens (slightly smaller/dimmer). Reposition both via refY-from-top and
// rewrite the module line to the cleaned name in parens. Recurses into subcircuit graphs.
function cleanSubcircuitCaptions(index) {
    for (const dev of Object.values(index.devices)) {
        const celltype = dev.get('celltype');
        if (!celltype) { continue; }
        const clean = cleanModuleName(celltype);
        dev.removeAttr('label/refDy');       // stop measuring the instance name from the bottom
        dev.attr('label/refY', -24);         // instance name → top line (above the box)
        dev.attr('type/text', `(${clean})`); // module name → second line, in parens
        dev.attr('type/refY', -11);          // just below the instance name, still above the box
        dev.attr('type/font-size', '7pt');
        dev.attr('type/opacity', 0.7);
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

// ---- persistent selection highlight ----
// Left-click latches an accent outline on a wire/port/instance and keeps it until clicked
// again; multiple stay lit at once, so you can light up a whole propagation path. Click a
// blank area to clear. Distinct from the transient hover glow. (Cross-nav / actions moved to
// the right-click menu.)
const _selected = new Set(); // highlighted cell-view <g> elements
function toggleSelect(cellView) {
    const el = cellView.el;
    if (_selected.has(el)) { el.classList.remove('sv-selected'); _selected.delete(el); }
    else { el.classList.add('sv-selected'); _selected.add(el); }
}
function clearSelection() {
    for (const el of _selected) { el.classList.remove('sv-selected'); }
    _selected.clear();
}

// ---- schematic load ----
function loadSchematic(msg) {
    if (circuit) {
        try { circuit.shutdown(); } catch (e) { /* ignore */ } // closes any open popups
        circuit = null;
        paper = null;
        labelIndex = null;
    }
    _openSubKeys.clear();      // popups from the previous schematic are gone
    _openSubDialogs.clear();
    _subTitles.clear();
    clearTaskbar();            // popup tabs from the previous render
    clearSelection();          // highlights belong to the previous render
    currentScopePath = msg.scopePath; // root for popup hierarchical titles
    currentMainName = msg.moduleName;
    if (_mainTab) { _mainTab.querySelector('.sv-tab-name').textContent = currentMainName; }
    spacing = SPACING[msg.spacing] || SPACING.compact; // density tier for this render (read by the patches below)
    _wireLabelDims.clear();    // net-label sizes are re-recorded as this design's wires build (at current tier)
    document.getElementById('breadcrumb').textContent = `${msg.scopePath}  (${msg.moduleName})`;
    document.getElementById('go-parent').disabled = !msg.hasParent;
    overviewMode = msg.overview === 'minimap' ? 'minimap' : 'scrollbars'; // main-paper overview
    applyWireValuePalette(); // theme-aware value colors (re-read each load to track theme)
    setStatus('laying out schematic…');
    const container = document.getElementById('paper-container');
    container.innerHTML = '<div id="paper"></div>';

    // default windowCallback uses jquery-ui dialogs (fine inside the webview); wrap it to give
    // the popup a breadcrumb-style title (full hier path + module, set in openSubcircuit) and
    // to blur the auto-focused zoom button so it doesn't open with a focus ring.
    circuit = new Circuit(msg.circuit, {
        layoutEngine: 'elkjs',
        windowCallback: function (type, div, closingCallback) {
            // raw title (= celltype + ' ' + label) is the per-instance key
            const key = div.attr('title') || '';
            if (key) {
                div.attr('title', _subTitles.get(key) || key.split(' ').map(cleanModuleName).join(' '));
                _openSubDialogs.set(key, div);
            }
            const wrappedClose = () => {
                _openSubKeys.delete(key);
                _openSubDialogs.delete(key);
                removeTaskbarTab(key);
                closingCallback();
            };
            Circuit.prototype._defaultWindowCallback.call(this, type, div, wrappedClose);
            constrainDialog(div); // keep it within the canvas, off the status bar
            addZoomTooltips(div); // tooltips on the – / + zoom buttons
            addPopupExport(div);  // per-popup export (⤓) button
            // a taskbar tab (switch between many popups) + a titlebar minimize button
            if (key) { addTaskbarTab(key); addMinimizeButton(div, key); }
            // jquery-ui autofocuses the first button (the zoom "−"), showing a focus ring on
            // open; drop it so the toolbar reads neutral until the user actually clicks.
            setTimeout(() => { const a = document.activeElement; if (a && typeof a.blur === 'function') { a.blur(); } }, 0);
        },
    });
    // 'new:paper' fires for the main paper AND each subcircuit popup paper — bind click,
    // hover, and navigation (wheel zoom/pan + drag pan) on all of them so popup windows
    // behave like the main canvas. (Registered before displayOn.)
    circuit.on('new:paper', (p) => {
        p.options.interactive = READONLY; // new views inherit it (see READONLY below)
        p.on('cell:pointerclick', (cellView) => toggleSelect(cellView)); // latch highlight
        p.on('blank:pointerclick', () => clearSelection());              // click empty → clear
        bindHover(p);
        bindContextMenu(p);
        attachNav(p);
        // After the paper unfreezes: lock all editing on every view, and learn this env's
        // per-char width once (so later layouts size exactly). We deliberately do NOT use
        // digitaljs's fixed() — that adds a `fixed` class whose `.joint-link{pointer-events:
        // none}` would swallow our click-to-highlight and right-click on wires. Instead we
        // turn off the editing interactions (move/link/vertex) but keep pointer events, and
        // neutralize the move/crosshair cursors in CSS.
        p.once('render:done', () => { p.setInteractivity(READONLY); calibrateCharPx(p); });
        // ELK positions cells asynchronously; drop the cached content bbox while it changes
        // so clamping/overviews recompute from the final layout, not a pre-layout box.
        watchAreaInvalidation(p.model);
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
    window.__schematic = { circuit, paper, labelIndex, fit: fitToView };
}

let baseStatus = ''; // persistent status (load / value count); hover overlays it transiently
function setStatus(text) {
    baseStatus = text;
    document.getElementById('status-text').textContent = text;
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
        // Child instances get no hover affordance (the user drills in via right-click → Expand,
        // not by hovering); their name is already the box caption.
        if (cv.model.get('celltype')) { return; }
        if (hovered) { hovered.classList.remove('sv-hover'); }
        hovered = cv.el;
        hovered.classList.add('sv-hover');
        document.getElementById('status-text').textContent = describe(cv.model);
    });
    p.on('cell:mouseleave', (cv) => {
        cv.el.classList.remove('sv-hover');
        if (hovered === cv.el) { hovered = null; }
        document.getElementById('status-text').textContent = baseStatus;
    });
}

// ---- right-click context menu ----
// One floating menu (appended to <body> so it works over the main paper AND popup dialogs).
// Items are filtered to what applies to the clicked element. "Expand" opens the child popup
// in-webview; every other action posts a contextAction to the extension (which reuses the
// existing tree commands). Left-click stays separate (cross-nav / highlight).
function elementInfo(model) {
    const isLink = typeof model.isLink === 'function' && model.isLink();
    const celltype = model.get('celltype');
    const type = model.get('type');
    return {
        model, isLink, celltype,
        isSub: !!celltype,
        isIO: type === 'Input' || type === 'Output',
        kind: isLink ? 'wire' : (celltype ? 'subcircuit' : 'device'),
        leafName: isLink ? model.get('netname') : (model.get('label') || model.get('net')),
        sourcePositions: model.get('source_positions') || [],
    };
}
// A "real" (user) RTL name resolves in the design tree; Yosys names synthesized/internal
// objects with a leading '$' ($procmux…, $driver…, $0\…) — those have no RTL source, so a
// leaf-name lookup can't resolve them.
function realName(i) { return !!i.leafName && !String(i.leafName).startsWith('$'); }
// "Go to source" can resolve a location iff: the element carries precise Yosys source
// positions, OR it's a child instance (→ its module's source), OR it has a real name (→ the
// design tree). Otherwise navigation would silently do nothing, so don't offer it.
function sourceNavigable(i) { return (i.sourcePositions && i.sourcePositions.length > 0) || i.isSub || realName(i); }
// Format a Vector3vl signal for display: '' when there's no real value (no waveform → all-x),
// else binary for narrow nets and 0x-hex for wider ones. Shared by the per-port value
// annotation (iovalue text) and the context-menu "Copy value".
function formatSig(sig) {
    if (!sig || typeof sig.toBin !== 'function') { return ''; }
    const bin = sig.toBin();
    if (/^x+$/i.test(bin)) { return ''; } // unannotated / released-to-x
    return (typeof sig.toHex === 'function' && bin.length > 4) ? '0x' + sig.toHex() : bin;
}
// Current annotated value as a copyable string, or undefined when there's no real value
// (no waveform loaded → all-x). Wires carry the signal; an IO/gate's value is on its output.
function currentValue(model) {
    let sig = model.get('signal');
    if (!sig) { const outs = model.get('outputSignals'); if (outs) { sig = Object.values(outs)[0]; } }
    const s = formatSig(sig);
    return s === '' ? undefined : s;
}
const CTX_ITEMS = [
    { label: 'Step into', applies: (i) => i.isSub, action: 'stepInto' }, // navigate the MAIN page into the child
    { label: 'Expand', applies: (i) => i.isSub, expand: true },          // open the child in a popup
    { label: 'Go to source', applies: (i) => sourceNavigable(i), action: 'gotoSource' },
    { label: 'Go to definition', applies: (i) => i.isSub || realName(i), action: 'gotoDefinition' },
    { sep: true },
    { label: 'Copy name', applies: (i) => !!i.leafName, action: 'copyName' },
    { label: 'Copy value', applies: (i) => currentValue(i.model) !== undefined, action: 'copyValue' },
    { label: 'Add to waveform', applies: (i) => i.isSub || realName(i), action: 'addToWaveform' },
];
let _ctxMenu = null;
function hideContextMenu() { if (_ctxMenu) { _ctxMenu.style.display = 'none'; } }
function showContextMenu(cellView, clientX, clientY) {
    if (!_ctxMenu) { _ctxMenu = document.createElement('div'); _ctxMenu.id = 'sv-ctxmenu'; document.body.appendChild(_ctxMenu); }
    const info = elementInfo(cellView.model);
    _ctxMenu.innerHTML = '';
    for (const item of CTX_ITEMS) {
        if (item.sep) {
            if (!_ctxMenu.lastChild || _ctxMenu.lastChild.className === 'sv-ctxsep') { continue; } // no leading/double sep
            const s = document.createElement('div'); s.className = 'sv-ctxsep'; _ctxMenu.appendChild(s); continue;
        }
        if (!item.applies(info)) { continue; }
        const row = document.createElement('div');
        row.className = 'sv-ctxitem';
        row.textContent = item.label;
        row.addEventListener('click', () => {
            hideContextMenu();
            if (item.expand) { openSubcircuit(info.model, cellView.paper); return; }
            post({
                type: 'contextAction', action: item.action, kind: info.kind,
                leafName: info.leafName, celltype: info.celltype, path: graphPath(info.model),
                sourcePositions: info.model.get('source_positions') || [],
                value: item.action === 'copyValue' ? currentValue(info.model) : undefined,
            });
        });
        _ctxMenu.appendChild(row);
    }
    while (_ctxMenu.lastChild && _ctxMenu.lastChild.className === 'sv-ctxsep') { _ctxMenu.removeChild(_ctxMenu.lastChild); }
    if (!_ctxMenu.querySelector('.sv-ctxitem')) { hideContextMenu(); return; } // nothing applies → no menu
    _ctxMenu.style.display = 'block';
    const mw = _ctxMenu.offsetWidth, mh = _ctxMenu.offsetHeight;
    _ctxMenu.style.left = Math.max(2, Math.min(clientX, window.innerWidth - mw - 4)) + 'px';
    _ctxMenu.style.top = Math.max(2, Math.min(clientY, window.innerHeight - mh - 4)) + 'px';
}
// dismiss on any outside interaction
document.addEventListener('pointerdown', (e) => { if (_ctxMenu && _ctxMenu.style.display !== 'none' && !_ctxMenu.contains(e.target)) { hideContextMenu(); } }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideContextMenu(); } });
window.addEventListener('blur', hideContextMenu);
// suppress the native (VS Code) context menu inside the schematic webview
document.addEventListener('contextmenu', (e) => e.preventDefault());
function bindContextMenu(p) {
    p.on('cell:contextmenu', (cellView, evt) => { showContextMenu(cellView, evt.clientX, evt.clientY); });
    p.on('blank:contextmenu', () => hideContextMenu());
}

// ---- pan / zoom (fully transform-based) ----
// The view is driven entirely by the paper's transform (scale + translate). We do NOT use
// digitaljs's content-sizing (it resizes the SVG to the content on every render, which
// breaks transform pan/zoom and wheel-scroll range). Instead the main paper is sized to
// the container, and all navigation moves the transform. Works identically on the main
// paper and on subcircuit popup papers.

let mainResizeObs = null;
let overviewMode = 'scrollbars'; // 'scrollbars' | 'minimap' (main); from the setting per load

// Content bounding box (graph-local), cached per GRAPH. It's a property of the cell
// positions, not the paper, so re-opened popup papers that share a subgraph reuse the
// correct cache. getContentArea is O(N); caching keeps pan-clamping O(1) per frame. The
// cache is INVALIDATED on layout changes — ELK lays the graph out asynchronously, so the
// first reads happen before cells are positioned; without this a stale (tiny, top-left)
// box gets cached and the clamp locks the view to the wrong region.
const _area = new WeakMap();          // graph -> content area
const _areaListened = new WeakSet();  // graphs that already have the invalidation listener
function contentAreaOf(p) {
    const g = p.model;
    let a = _area.get(g);
    if (!a) {
        a = p.getContentArea({ useModelGeometry: true });
        if (a && a.width && a.height) { _area.set(g, a); }
    }
    return a;
}
// Invalidate a graph's cached bbox when its layout changes — once per graph, so reopening
// the same subcircuit popup doesn't stack duplicate listeners (which would also retain the
// disposed popup papers). WeakSet/WeakMap drop the graph entry when the graph is GC'd.
function watchAreaInvalidation(g) {
    if (_areaListened.has(g)) { return; }
    _areaListened.add(g);
    g.on('change:position change:size add remove', () => _area.delete(g));
}

// Clamp a translate so the viewport can't pan off the content into infinite emptiness.
// Zoomed in (content larger than the viewport) you can pan across all of it, with at most
// `margin` px of empty space past an edge. Zoomed out (content fits) it center-locks ±margin.
function clampTranslate(p, tx, ty) {
    const a = contentAreaOf(p);
    if (!a) { return [tx, ty]; }
    const s = p.scale().sx;
    const sz = p.getComputedSize();
    const W = sz.width, H = sz.height;
    const mX = Math.min(W * 0.5, 250), mY = Math.min(H * 0.5, 250);
    const cL = a.x * s, cR = (a.x + a.width) * s, cT = a.y * s, cB = (a.y + a.height) * s;
    // For one axis: content spans [c0, cEnd] in screen px at translate 0; viewport is [0, view].
    const axis = (c0, cEnd, view, m) => {
        if (cEnd - c0 <= view) {                 // content fits this axis: center it, ±m wiggle
            const mid = (view - (cEnd - c0)) / 2 - c0;
            return [mid - m, mid + m];
        }
        return [view - cEnd - m, -c0 + m];       // larger than viewport: pan across, ≤ m past an edge
    };
    const [txLo, txHi] = axis(cL, cR, W, mX);
    const [tyLo, tyHi] = axis(cT, cB, H, mY);
    return [Math.min(Math.max(tx, txLo), txHi), Math.min(Math.max(ty, tyLo), tyHi)];
}

// Translate a paper with clamping (all pan paths funnel through here).
function panTo(p, tx, ty) {
    const [cx, cy] = clampTranslate(p, tx, ty);
    p.translate(cx, cy);
}

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

// Subcircuit popup paper: opens at a fraction of the viewport, then FOLLOWS the jquery-ui
// dialog as the user resizes it (the canvas was previously frozen at its initial size, so a
// resized popup left dead space). Transform-based like the main paper, with overlay scrollbars.
//
// Available paper size = the dialog content area minus the zoom toolbar. Before jquery-ui has
// wrapped the content (it does so on render:done, after this runs), or when detached, fall
// back to the initial w×h.
function popupAvailSize(content, w, h) {
    if (content && content.isConnected && content.classList.contains('ui-dialog-content')) {
        // Use the content-box inner size: clientWidth/Height INCLUDE padding, and sizing the
        // paper to that would make the auto-width dialog grow by the padding on each observer
        // tick (inflating to maxWidth). Subtract padding (and the zoom toolbar) → stable.
        const cs = getComputedStyle(content);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const btn = content.querySelector('.btn-group');
        const aw = content.clientWidth - padX;
        const ah = content.clientHeight - padY - (btn ? btn.offsetHeight : 0);
        if (aw > 50 && ah > 50) { return { w: Math.round(aw), h: Math.round(ah) }; }
    }
    return { w, h };
}
function setupPopupPaper(p) {
    neutralizeAutoResize(p);
    const w = Math.min(900, Math.round(window.innerWidth * 0.7));
    const h = Math.min(600, Math.round(window.innerHeight * 0.7));
    p.setDimensions(w, h);
    // p.el = the .joint-paper container div; its parent is the jquery-ui dialog content
    // (gets class `ui-dialog-content` once the dialog is created on render:done).
    const content = p.el.parentElement;
    if (content) { content.__svPaper = p; } // so the popup's export button can target this paper
    // initial fit (centered) once the dialog + child layout exist
    const fit = () => { const s = popupAvailSize(content, w, h); fitPaper(p, s.w, s.h); };
    p.once('render:done', fit);
    setTimeout(fit, 200); // catch async ELK layout of the child
    attachScrollbars(p, p.el);
    // Follow the dialog as it's resized WITHOUT re-fitting: grow/shrink the viewport to the
    // new content area and keep the user's zoom, only re-clamping the pan so content stays in
    // view. setDimensions fires the paper 'resize' event, so the overlay scrollbars recompute.
    // Self-disconnects when the popup closes (content detached).
    if (content && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            if (!content.isConnected) { ro.disconnect(); return; }
            const s = popupAvailSize(content, w, h);
            p.setDimensions(s.w, s.h);
            const t = p.translate();
            panTo(p, t.tx, t.ty); // re-clamp to the new viewport
        });
        ro.observe(content);
    }
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

    function update() {
        const a = contentAreaOf(p);
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
            if (axis === 'x') { panTo(p, t0.tx - dLocal * s, t0.ty); }
            else { panTo(p, t0.tx, t0.ty - dLocal * s); }
        };
        const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    });
    drag(hb, 'x'); drag(vb, 'y');

    p.on('transform', update);
    p.on('resize', update);
    setTimeout(update, 300); // after async layout settles (content area is cached centrally)
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
        area = contentAreaOf(p);
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
        panTo(p, host.clientWidth / 2 - lx * s, host.clientHeight / 2 - ly * s);
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
    // Don't clamp zoom: zooming around the cursor keeps that point fixed, so it can't push
    // content off into emptiness. Only pan is clamped (below). This preserves cursor-fixed
    // zoom even when the content is smaller than the viewport.
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
            panTo(p, t.tx - dx, t.ty - dy);
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
        panTo(p, startT.tx + (evt.clientX - startX), startT.ty + (evt.clientY - startY));
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

// ---- export ----
// Serialize the main paper as a standalone SVG. The on-file SVG has none of our CSS or the VS
// Code theme vars, so we (1) frame the FULL content via a viewBox on the content bounds (drop
// the live pan/zoom so current zoom doesn't matter), (2) bake the computed presentation styles
// (fill/stroke/font/…) inline so it looks identical, (3) drop foreignObjects (hidden widgets),
// (4) paint the theme background behind it (white would hide the light-on-dark schematic).
const SVG_STYLE_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin', 'opacity', 'color', 'display', 'visibility',
    'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
    'dominant-baseline', 'text-decoration',
];
function inlineComputedStyles(live, clone) {
    if (live.nodeType === 1 && clone.nodeType === 1) {
        const cs = getComputedStyle(live);
        let style = clone.getAttribute('style') || '';
        for (const p of SVG_STYLE_PROPS) { const v = cs.getPropertyValue(p); if (v) { style += `${p}:${v};`; } }
        clone.setAttribute('style', style);
    }
    const lk = live.children, ck = clone.children;
    for (let i = 0; i < lk.length && i < ck.length; i++) { inlineComputedStyles(lk[i], ck[i]); }
}
// Which paper an export targets: a popup's paper if its export button was clicked, else main.
let _exportPaper = null;
function exportTarget() { return _exportPaper || paper; }
// Hierarchical name of the paper's scope (a popup → its subcircuit instance path; main → scope).
function paperHierName(p) {
    const sub = p.model.get('subcircuit');
    if (sub && sub !== true && typeof sub.get === 'function') {
        return [currentScopePath, ...graphPath(sub), sub.get('label')].filter(Boolean).join('.');
    }
    return currentScopePath;
}
function buildSvgExport() {
    const tp = exportTarget();
    const live = tp.el.querySelector('svg');
    if (!live) { return ''; }
    const clone = live.cloneNode(true);
    const a = tp.getContentArea({ useModelGeometry: true });
    const pad = 20;
    const x = Math.round(a.x - pad), y = Math.round(a.y - pad);
    const w = Math.round(a.width + 2 * pad), h = Math.round(a.height + 2 * pad);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    // drop the pan/zoom transform so the content sits at its model coordinates (= the viewBox)
    const layers = clone.querySelector('.joint-layers') || clone.querySelector('g');
    if (layers) { layers.removeAttribute('transform'); }
    inlineComputedStyles(live, clone);
    clone.querySelectorAll('foreignObject').forEach((n) => n.remove());
    const bg = getComputedStyle(document.body).backgroundColor || '#1e1e1e';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}
// digitaljs circuit JSON (with the current ELK layout baked in) — re-loadable into a Circuit.
function buildJsonExport() {
    return JSON.stringify(circuit.toJSON(), null, 2);
}
// Rasterize the export SVG to a PNG (base64). The SVG already has foreignObjects stripped and
// styles inlined, so the canvas isn't tainted. Render at ~2× for crispness, capped so very
// large schematics don't produce an enormous bitmap.
function buildPngExport() {
    const a = exportTarget().getContentArea({ useModelGeometry: true });
    const pad = 20;
    const w = Math.max(1, Math.round(a.width + 2 * pad)), h = Math.max(1, Math.round(a.height + 2 * pad));
    const scale = Math.min(2, 6000 / Math.max(w, h));
    const svg = buildSvgExport();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(w * scale));
                canvas.height = Math.max(1, Math.round(h * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png').split(',')[1]);
            } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('SVG failed to rasterize for PNG export'));
        img.src = url;
    });
}

document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.25));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(0.8));
document.getElementById('zoom-fit').addEventListener('click', fitToView);
document.getElementById('refresh').addEventListener('click', () => post({ type: 'refresh' }));
document.getElementById('go-parent').addEventListener('click', () => post({ type: 'goToParent' }));
document.getElementById('export').addEventListener('click', () => { _exportPaper = null; post({ type: 'export' }); });
// RTL / Gate-Level slider toggle: left = RTL (unchecked), right = Gate-Level (checked).
const presetSwitch = document.getElementById('preset-switch');
const presetLabels = document.querySelectorAll('#preset-toggle .sv-seg-label');
function setPreset(gls) {
    presetSwitch.checked = gls;
    presetLabels.forEach((l) => l.classList.toggle('active', (l.dataset.side === 'gls') === gls));
    post({ type: 'setPreset', preset: gls ? 'gls' : 'rtl' });
}
presetSwitch.addEventListener('change', () => setPreset(presetSwitch.checked));
presetLabels.forEach((l) => l.addEventListener('click', () => setPreset(l.dataset.side === 'gls')));

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
        case 'buildExport':
            (async () => {
                try {
                    if (msg.format === 'svg') { post({ type: 'exportContent', format: 'svg', text: buildSvgExport() }); }
                    else if (msg.format === 'json') { post({ type: 'exportContent', format: 'json', text: buildJsonExport() }); }
                    else if (msg.format === 'png') { post({ type: 'exportContent', format: 'png', base64: await buildPngExport() }); }
                } catch (e) {
                    setStatus('Export failed: ' + (e && e.message ? e.message : e));
                    console.error(e);
                }
            })();
            break;
    }
});

post({ type: 'ready' });
