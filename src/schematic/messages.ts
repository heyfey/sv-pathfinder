// Message contracts between the schematic webview and the extension.
// Keep stable: Phases 1-3 compose through these (see integration plan §5).

export interface SourcePosition {
    name: string; // file name as Yosys saw it (may be relative to the yosys cwd)
    from: { line: number; column: number };
    to?: { line: number; column: number }; // absent for point (non-range) positions
}

// webview -> extension
export interface ElementClickMessage {
    type: 'elementClick';
    kind: 'wire' | 'device' | 'subcircuit';
    leafName?: string;       // netname for wires, label for devices/instances
    celltype?: string;       // for subcircuit boxes: (uniquified) module name
    path?: string[];         // enclosing subcircuit instance labels (clicks inside popup windows)
    sourcePositions: SourcePosition[];
    action: 'source' | 'declaration'; // plain click = source; e.g. dblclick = declaration
}

export interface WebviewReadyMessage {
    type: 'ready';
}

export interface GoToParentMessage {
    type: 'goToParent';
}

// webview -> extension: a right-click context-menu action on an element. Expand (open popup)
// is handled entirely in the webview and does NOT come through here.
export interface ContextActionMessage {
    type: 'contextAction';
    action: 'stepInto' | 'gotoSource' | 'gotoDefinition' | 'copyName' | 'addToWaveform' | 'copyValue';
    kind: 'wire' | 'device' | 'subcircuit';
    leafName?: string;
    celltype?: string;
    path?: string[];
    sourcePositions: SourcePosition[];
    value?: string; // current annotated value, for copyValue
}

// webview -> extension: user asked to export the schematic (main toolbar or a popup)
export interface ExportRequestMessage {
    type: 'export';
    name?: string; // suggested base filename (a popup's hierarchy path; absent = main scope)
}

// webview -> extension: the generated export content for the file the user chose
export interface ExportContentMessage {
    type: 'exportContent';
    format: string;
    text?: string;   // utf-8 content (svg / json)
    base64?: string; // binary content (png)
}

export type FromWebviewMessage = ElementClickMessage | WebviewReadyMessage | GoToParentMessage
    | ContextActionMessage | ExportRequestMessage | ExportContentMessage;

// extension -> webview
export interface LoadSchematicMessage {
    type: 'loadSchematic';
    circuit: any;            // DigitalJS JSON (TopModule)
    scopePath: string;       // breadcrumb, e.g. top.cpu.alu
    moduleName: string;
    hasParent: boolean;      // whether a parent scope exists (enables the "go to parent" button)
    overview: 'minimap' | 'scrollbars'; // main-paper overview style (popups always use scrollbars)
    spacing: 'compact' | 'comfortable' | 'spacious'; // layout density (ELK spacing + box padding)
    backend?: string;        // resolved yosys backend name (for diagnostics on a render failure)
}

export interface SetValuesMessage {
    type: 'setValues';
    // values: the full value array vaporview reports AT the cursor for each net — usually a single
    // value, but [old, new] on a transition and [old, n1, …, final] for a glitch (rare, FSDB). The
    // webview renders the whole chain joined with → (a value change/glitch is significant in
    // hardware, so we don't hide it) and colours by the last element. raw binary-ish; webview
    // sanitizes.
    updates: { name: string; values: string[] }[];
}

export interface ClearValuesMessage {
    type: 'clearValues';
}

// extension -> webview: build export content in the given format (chosen from the save dialog)
export interface BuildExportMessage {
    type: 'buildExport';
    format: 'svg' | 'png' | 'json';
}

export type ToWebviewMessage = LoadSchematicMessage | SetValuesMessage | ClearValuesMessage | BuildExportMessage;
