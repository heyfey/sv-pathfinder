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
    sourcePositions: SourcePosition[];
    action: 'source' | 'declaration'; // plain click = source; e.g. dblclick = declaration
}

export interface WebviewReadyMessage {
    type: 'ready';
}

export type FromWebviewMessage = ElementClickMessage | WebviewReadyMessage;

// extension -> webview
export interface LoadSchematicMessage {
    type: 'loadSchematic';
    circuit: any;            // DigitalJS JSON (TopModule)
    scopePath: string;       // breadcrumb, e.g. top.cpu.alu
    moduleName: string;
}

export interface SetValuesMessage {
    type: 'setValues';
    updates: { name: string; value: string }[]; // value: raw binary-ish string, webview sanitizes
}

export interface ClearValuesMessage {
    type: 'clearValues';
}

export type ToWebviewMessage = LoadSchematicMessage | SetValuesMessage | ClearValuesMessage;
