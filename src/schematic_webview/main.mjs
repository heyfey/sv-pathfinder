// Schematic webview script: hosts digitaljs (current stock, JointJS/ELK) and bridges
// to the extension. The simulation engine is constructed but NEVER started — wire
// values are driven externally from VaporView data (Spike 2 recipe).
import { Circuit } from 'digitaljs';
import { Vector3vl } from '3vl';
// our overrides must come after digitaljs's own CSS (pulled in by the import above)
import './style.css';

const vscode = acquireVsCodeApi();

let circuit = null;
let paper = null;
let labelIndex = null;
let zoomLevel = 0;

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
function emitClick(model) {
    const isLink = typeof model.isLink === 'function' && model.isLink();
    const celltype = model.get('celltype');
    post({
        type: 'elementClick',
        kind: isLink ? 'wire' : (celltype ? 'subcircuit' : 'device'),
        leafName: isLink ? model.get('netname') : model.get('label'),
        celltype,
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
    const container = document.getElementById('paper-container');
    container.innerHTML = '<div id="paper"></div>';

    // subcircuitButtons/windowCallback defaults use jquery-ui dialogs; fine inside the webview
    circuit = new Circuit(msg.circuit, { layoutEngine: 'elkjs' });
    paper = circuit.displayOn(paperDiv());
    labelIndex = circuit.getLabelIndex();
    cleanSubcircuitCaptions(labelIndex);

    // never start the engine — external values only
    paper.on('cell:pointerclick', (cellView) => emitClick(cellView.model));

    zoomLevel = 0;
    setStatus(`${Object.keys(labelIndex.wires).length} named nets, ` +
              `${Object.keys(labelIndex.devices).length} devices`);

    // debug/test handle (also used by the headless webview test)
    window.__schematic = { circuit, paper, labelIndex };
}

function setStatus(text) {
    document.getElementById('status').textContent = text;
}

// ---- toolbar ----
function setZoom(level) {
    zoomLevel = Math.max(-10, Math.min(10, level));
    if (circuit && paper) { circuit.scaleAndRefreshPaper(paper, zoomLevel); }
}
document.getElementById('zoom-in').addEventListener('click', () => setZoom(zoomLevel + 1));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(zoomLevel - 1));
document.getElementById('zoom-fit').addEventListener('click', () => setZoom(0));
document.getElementById('refresh').addEventListener('click', () => post({ type: 'refresh' }));
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
