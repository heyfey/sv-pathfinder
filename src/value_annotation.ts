import * as vscode from 'vscode';

import { HierarchyTreeProvider, NetlistItem } from './tree_view';
import { Parser } from './parser';

function parseWaveformValue(values: string): string | undefined {
    const v = JSON.parse(values);
    const v1 = v[0];
    const v2 = v[1];
    if (v1 === undefined) {
        return undefined;
    }
    if (v2) {
        return `${v1}->${v2}`;
    }
    return `${v1}`;
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

            for (const [variableName, ranges] of this.rangesMap) {
                const decorationType = this.decorationTypesMap.get(variableName);
                if (decorationType) {
                    editor.setDecorations(decorationType, ranges);
                }
            }
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
        this.debounceTimer = setTimeout(() => {
            this.updateDecorations();
        }, this.debounceTimerDelay);
    }

    // #region updateDecorations()
    public async updateDecorations() {
        const visibleEditors = vscode.window.visibleTextEditors;
        for (const editor of visibleEditors) {
            // TODO: Only update the target file, which should be known in advance
            if (editor.document.languageId === 'verilog' || editor.document.languageId === 'systemverilog') {
                this.updateDecorationsForEditor(editor);
            }
        }
    }

    public async updateDecorationsForEditor(editor: vscode.TextEditor) {
        this.clearDecorations();

        // Get metadata from the active design
        const activeDesign = this.hierarchyTreeProvider.getActiveDesign();
        if (!activeDesign) { return; }

        const activeModule = activeDesign.getActiveModule();
        if (!activeModule) { return; }

        const activeWaveform = activeDesign.getActiveWaveform();
        if (!activeWaveform) { return; }

        const document = editor.document;
        this.targetFile = document.uri.fsPath; // TODO: use source file in NetlistItem

        const nodes = await this.parser.parseAndCollectIdentifiersInModule(document, activeModule);
        if (!nodes || nodes.length === 0) { return; }

        // Get all unique variable names within the module
        const variableNameSet = new Set();
        for (const node of nodes) {
            variableNameSet.add(node.text);
        }

        // Get instance paths for variables
        const scopeName = activeDesign.getActiveScope();
        const instancePaths = [];
        for (const variableName of variableNameSet) {
            const instancePath = scopeName ? `${scopeName}.${variableName}` : variableName;
            instancePaths.push(instancePath);
        }
        // console.log('Instance paths:', instancePaths);

        // Get waveform values from waveform viewer
        const waveformValues = await vscode.commands.executeCommand<{ instancePath: string; value: string }[]>(
            "waveformViewer.getValuesAtTime",
            { uri: activeWaveform.resourceUri.toString(), instancePaths: instancePaths }
        );

        // Store [variableName, waveform value] in a map
        // TODO: This map is not necessary. Could create decorationTypesMap directly
        const waveformValueMap = new Map<string, string>();
        for (const v of waveformValues) {
            const variableName = v.instancePath.split('.').pop()!;
            const value = parseWaveformValue(v.value);
            if (value === undefined) { continue; }
            waveformValueMap.set(variableName, value);
        }

        // Store [variableName, decorationType] in decorationTypesMap
        for (const [variableName, value] of waveformValueMap) {
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
            this.decorationTypesMap.set(variableName, decorationType);
        }

        // Create ranges for each variable
        for (const node of nodes) {
            // Skip the node that didn't found in the waveform viewer
            if (!waveformValueMap.get(node.text)) { continue; }
            const range = new vscode.Range(
                new vscode.Position(node.startPosition.row, node.startPosition.column),
                new vscode.Position(node.endPosition.row, node.endPosition.column)
            );
            // Append the range to the rangesMap for the variable
            if (this.rangesMap.has(node.text)) {
                this.rangesMap.get(node.text)?.push(range);
            }
            else {
                this.rangesMap.set(node.text, [range]);
            }
        }

        // Apply decorations for each variable
        for (const [variableName, ranges] of this.rangesMap) {
            const decorationType = this.decorationTypesMap.get(variableName);
            if (decorationType) {
                editor.setDecorations(decorationType, ranges);
            }
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
    }
}