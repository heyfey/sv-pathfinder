import * as vscode from 'vscode';

import { HierarchyTreeProvider, NetlistItem } from './tree_view';
import { Parser } from './parser';

function parseWaveformValue(values: any): string | undefined {
    let v: string[];
    if (typeof values === 'string') {
        v = JSON.parse(values);
    } else if (Array.isArray(values)) {
        v = values;
    } else {
        console.error(`Unexpected type for values: ${typeof values}`);
        return undefined;
    }
    let result: string = v[0];
    if (v.length === 1) {
        return `${result}`;
    }
    for (let i = 1; i < v.length; i++) {
        result += '->';
        result += v[i];
    }
    return `${result}`;
}

// #region WaveformValueAnnotationProvider
export class WaveformValueAnnotationProvider {
    // Cache decoration types and ranges for variables
    // Note that we only need to re-caculate decorations when the timestamp or the active instance changes
    private decorationTypesMap = new Map<string, vscode.TextEditorDecorationType>();
    private rangesMap = new Map<string, vscode.Range[]>();

    private timestamp: number = -1;
    private activeInstance: NetlistItem | undefined;
    private targetFile: string | undefined; // TODO: use source file in NetlistItem

    private debounceTimer: NodeJS.Timeout;
    private debounceTimerDelay: number = 100; // 100ms delay

    constructor(
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly parser: Parser,
    ) {
        // Initialize the debounce timer
        this.debounceTimer = setTimeout(() => { }, 0);
    }

    // #region handle events
    async listenToMarkerSetEventEvent(): Promise<vscode.Disposable | undefined> {
        // Get the extension by its ID
        const waveformViewer = vscode.extensions.getExtension('lramseyer.vaporview');
        if (!waveformViewer) { return undefined; }
        // Ensure the extension is active
        if (!waveformViewer.isActive) {
            await waveformViewer.activate();
        }
        // Access the exported API
        const api = waveformViewer.exports;
        // Verify the API and event exist
        if (api && api.onDidSetMarker) {
            // Subscribe to the event and return the Disposable
            const disposable = api.onDidSetMarker((data: any) => {
                // Check is interested waveform file
                // TODO: change to data.uri
                // if (data.uri !== this.hierarchyTreeProvider.getActiveDesign()?.getActiveWaveform()?.resourceUri.toString()) {
                if (data.uri.fsPath !== this.hierarchyTreeProvider.getActiveDesign()?.getActiveWaveform()?.resourceUri.fsPath) {
                    return;
                }
                // Check if the timestamp has changed
                if (data.time === this.timestamp) {
                    return;
                }
                this.timestamp = data.time;
                this.debounceUpdateDecorations();
            });
            return disposable;
        }

        // Return undefined if the extension or event is unavailable
        return undefined;
    }

    public async handleChangeVisibleTextEditors() {
        // No need to re-caculate decorations if simply visible text editors changed
        // Apply cached decorations to the target file if present
        if (this.targetFile && this.decorationTypesMap.size !== 0 && this.rangesMap.size !== 0) {
            const editor = vscode.window.visibleTextEditors.find(
                (editor) => editor.document.uri.fsPath === this.targetFile
            );
            if (!editor) { return; }
            this.applyCachedDecorationsToEditor(editor);
            return;
        } else {
            this.debounceUpdateDecorations();
        }
    }

    public async handleChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
        // No need to update decorations if the document is not the target file
        if (this.targetFile !== e.document.uri.fsPath) { return; }
        this.debounceUpdateDecorations();
    }

    public async handleActiveInstanceChanges(e: void | NetlistItem | null | undefined) {
        if (!e) { return; }
        // Only need to update decorations if the active instance has changed
        // Check if the active instance is the same as the previous one
        if (this.activeInstance && this.activeInstance === e) { return; }
        this.activeInstance = e;
        this.debounceUpdateDecorations();
    }

    public async handleActiveWaveformChanges(e: void | vscode.TreeItem | null | undefined) {
        this.debounceUpdateDecorations();
    }

    public async debounceUpdateDecorations() {
        // Clear any existing timer
        clearTimeout(this.debounceTimer);
        // Set a new timer to call updateDecorations after delay
        this.debounceTimer = setTimeout(async () => {
            await this.updateDecorations();
        }, this.debounceTimerDelay);
    }

    // #region updateDecorations()
    public async updateDecorations() {
        this.clearDecorations();
        const visibleEditors = vscode.window.visibleTextEditors.filter(
            editor => editor.document.languageId === 'verilog' || editor.document.languageId === 'systemverilog'
        );
        for (const editor of visibleEditors) {
            // TODO: Only update the target file, which should be known in advance
            await this.updateDecorationsForEditor(editor);
        }
    }

    public async updateDecorationsForEditor(editor: vscode.TextEditor) {
        // Get metadata from the active design
        const activeDesign = this.hierarchyTreeProvider.getActiveDesign();
        if (!activeDesign) { return; }

        const activeInstance = activeDesign.getActiveInstance();
        if (!activeInstance) { return; }

        const activeModule = activeDesign.getActiveModule();
        if (!activeModule) { return; }

        const activeWaveform = activeDesign.getActiveWaveform();
        if (!activeWaveform) { return; }

        const document = editor.document;
        this.targetFile = document.uri.fsPath; // TODO: use source file in NetlistItem

        const nodes = await this.parser.parseAndCollectIdentifiersInModule(document, activeModule);
        if (!nodes || nodes.length === 0) { return; }

        // Get all variable instance paths in the active instance
        const instancePaths = await activeInstance.getAllChildVarsNames(activeDesign);

        // Get waveform values from waveform viewer
        const waveformValues = await vscode.commands.executeCommand<{ instancePath: string; value: string }[]>(
            "waveformViewer.getValuesAtTime",
            { uri: activeWaveform.resourceUri.toString(), instancePaths: instancePaths }
        );

        // Store [variableName, waveform value] in a map
        const waveformValueMap = new Map<string, string>();
        for (const v of waveformValues) {
            const variableName = v.instancePath.split('.').pop()!;
            const value = parseWaveformValue(v.value);
            if (value === undefined) { continue; }
            waveformValueMap.set(variableName, value);
        }

        // Show the waveform values in the hierarchy view treeItem's description
        await this.hierarchyTreeProvider.updateWaveformValuesDescriptions(activeInstance, waveformValueMap);

        // Create new decorations with unique keys
        for (const node of nodes) {
            if (!waveformValueMap.has(node.text)) { continue; }
            const value = waveformValueMap.get(node.text)!;

            // Use unique key to prevent duplicates
            const variableKey = `${node.text}:${node.startPosition.row}:${node.startPosition.column}`;
            if (this.rangesMap.has(variableKey)) {
                // console.warn(`WaveformValueAnnotationProvider: Duplicate symbol ${node.text} at ${node.startPosition.row}:${node.startPosition.column}`);
                continue;
            }

            const decorationType = vscode.window.createTextEditorDecorationType({
                after: {
                    contentText: `${value}`,
                    fontStyle: 'italic bold',
                    color: new vscode.ThemeColor('editorInlayHint.foreground'),
                    backgroundColor: new vscode.ThemeColor('editorInlayHint.background'),
                    margin: '8px 8px 8px 8px',
                    textDecoration: `border: 1px solid ${new vscode.ThemeColor('editorWidget.border')}; border-radius: 8px;`,
                }
            });

            const range = new vscode.Range(
                new vscode.Position(node.startPosition.row, node.startPosition.column),
                new vscode.Position(node.endPosition.row, node.endPosition.column)
            );

            this.decorationTypesMap.set(variableKey, decorationType);
            this.rangesMap.set(variableKey, [range]);
            editor.setDecorations(decorationType, [range]);
        }
    }

    private applyCachedDecorationsToEditor(editor: vscode.TextEditor) {
        // Clear existing decorations for this editor
        for (const decorationType of this.decorationTypesMap.values()) {
            editor.setDecorations(decorationType, []);
        }
        // Apply cached decorations
        for (const [variableKey, decorationType] of this.decorationTypesMap) {
            const ranges = this.rangesMap.get(variableKey) || [];
            editor.setDecorations(decorationType, ranges);
        }
    }

    private clearDecorations() {
        // Clear all existing decorations
        for (const decorationType of this.decorationTypesMap.values()) {
            decorationType.dispose();
        }
        // Clear all cached results
        this.decorationTypesMap.clear();
        this.rangesMap.clear();

        // Clear decorations from all visible editors for the target file
        const visibleEditors = vscode.window.visibleTextEditors;
        for (const editor of visibleEditors) {
            if (editor.document.uri.fsPath === this.targetFile) {
                for (const decorationType of this.decorationTypesMap.values()) {
                    editor.setDecorations(decorationType, []);
                }
            }
        }
    }
}