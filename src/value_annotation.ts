import * as vscode from 'vscode';

import { HierarchyTreeProvider, ModuleInstancesTreeProvider, NetlistItem } from './tree_view';

function extractValueChangeString(values: string): string | undefined {
    const v = JSON.parse(values);
    const value1 = v[0];
    const value2 = v[1];
    if (value1 === undefined) {
        return undefined;
    }
    if (value2) {
        return `${value1}->${value2}`;
    }
    return `${value1}`;
}

export class WaveformValueAnnotationProvider {
    // Cache decoration types and ranges
    // Note that we only need to update decorations when the timestamp or the activeInstance changes
    private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
    private variableRanges = new Map<string, vscode.Range[]>();

    private timestamp: number = -1;
    private activeInstance: NetlistItem | undefined;
    private activeFile: string | undefined; // TODO: use source file in NetlistItem

    private debounceTimer: NodeJS.Timeout;
    private debounceTimerDelay: number = 100; // 100ms delay

    constructor(
        private readonly hierarchyView: vscode.TreeView<NetlistItem>,
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly moduleInstancesTreeProvider: ModuleInstancesTreeProvider,
    ) {
        // Initialize the debounce timer
        this.debounceTimer = setTimeout(() => { }, 0);
    }

    async listenToMarkerSetEventEvent(): Promise<vscode.Disposable | undefined> {
        // Get the extension by its ID
        const waveformViewer = vscode.extensions.getExtension('lramseyer.vaporview');
        if (waveformViewer) {
            // Ensure the extension is active
            if (!waveformViewer.isActive) {
                await waveformViewer.activate();
            }
            // Access the exported API
            const api = waveformViewer.exports;
            // Verify the API and event exist
            if (api && api.markerSetEvent) {
                // Subscribe to the event and return the Disposable
                const disposable = api.markerSetEvent.event((data: any) => {
                    // Check is interested waveform file
                    // TODO: change to data.uri
                    // if (data.uri !== this.hierarchyTreeProvider.getActiveDesign()?.getActiveWaveform()?.resourceUri.toString()) {
                    if (data.filePath !== this.hierarchyTreeProvider.getActiveDesign()?.getActiveWaveform()?.resourceUri.fsPath) {
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
        }
        // Return undefined if the extension or event is unavailable
        return undefined;
    }

    public async handleChangeVisibleTextEditors() {
        // Cache is not empty
        if (this.activeFile && this.decorationTypes.size !== 0 && this.variableRanges.size !== 0) {
            // Get editor from activeFile
            const editor = vscode.window.visibleTextEditors.find(
                (editor) => editor.document.uri.fsPath === this.activeFile
            );
            if (!editor) { return; }

            // Apply cached decorations
            for (const [variableName, ranges] of this.variableRanges) {
                const decorationType = this.decorationTypes.get(variableName);
                if (decorationType) {
                    editor.setDecorations(decorationType, ranges);
                }
            }
            return;
        }
        this.debounceUpdateDecorations();
    }

    public async handleChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
        if (this.activeFile !== e.document.uri.fsPath) { return; }
        this.debounceUpdateDecorations();
    }

    public async handleActiveInstanceChanges(e: void | NetlistItem | null | undefined) {
        if (!e) { return; }
        // Check if the active instance has really changed
        if (this.activeInstance && this.activeInstance === e) { return; }
        this.activeInstance = e;
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

    public async updateDecorations() {
        // Get all visible editors
        const visibleEditors = vscode.window.visibleTextEditors;

        // Iterate through each editor
        for (const editor of visibleEditors) {
            // Check if the editor is a Verilog file
            if (editor.document.languageId === 'verilog') { // TODO: Only update the target file, which should be known in advance
                // Call updateDecorations for each editor
                this.updateDecorationsForEditor(editor);
            }
        }
    }

    public async updateDecorationsForEditor(editor: vscode.TextEditor) {
        // Clear all decorations
        for (const decorationType of this.decorationTypes.values()) {
            decorationType.dispose();
        }
        this.decorationTypes.clear();
        this.variableRanges.clear();

        // console.log(editor.document.uri.toString());
        // console.log(this.hierarchyTreeProvider.getActiveDesign()?.getActiveInstance());

        const activeDesign = this.hierarchyTreeProvider.getActiveDesign();
        if (!activeDesign) { return; }

        const activeModule = activeDesign.getActiveModule();
        if (!activeModule) { return; }

        const activeWaveform = activeDesign.getActiveWaveform();
        if (!activeWaveform) { return; }

        const document = editor.document;
        // Get document symbols
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        if (!symbols) { return; }

        const moduleSymbol = symbols.find(
            // 4 in svlangserver
            // 5 in Verible
            symbol => symbol.name === activeModule && symbol.kind === 9 /*symbol.kind === vscode.SymbolKind.Module*/
        );
        if (!moduleSymbol) {
            return;
        }
        const moduleRange = moduleSymbol.range;
        this.activeFile = document.uri.fsPath; // TODO: use source file in NetlistItem

        // Get all unique variables within the module
        const variables = [];
        const nameSet = new Set();
        for (const child of moduleSymbol.children) {
            if ((child.kind === 12 || child.kind === 7) && !nameSet.has(child.name)) {
                nameSet.add(child.name);
                variables.push(child);
            }
        }
        // console.log('Variables:', variables);

        // Get instance paths for variables
        const scopeName = this.hierarchyTreeProvider.getActiveDesign()?.getActiveScope();
        const instancePaths = [];
        for (const variable of variables) {
            const instancePath = scopeName + '.' + variable.name;
            instancePaths.push(instancePath);
        }
        // console.log('Instance paths:', instancePaths);

        // Get value changes from waveform viewer
        const valueChanges = await vscode.commands.executeCommand<{ instancePath: string; value: string }[]>(
            "waveformViewer.getValuesAtTime",
            { uri: activeWaveform.resourceUri.toString(), instancePaths: instancePaths }
        );
        // Store [variableName, value change] in a map
        const valueChangeMap = new Map<string, string>();
        for (const valueChange of valueChanges) {
            const variableName = valueChange.instancePath.split('.').pop()!;
            const vcString = extractValueChangeString(valueChange.value);
            if (vcString === undefined) { continue; }
            valueChangeMap.set(variableName, vcString);
        }

        // Create decorationType for each variable and store in a map
        for (const variable of variables) {
            const valueChange = valueChangeMap.get(variable.name);
            const decorationType = vscode.window.createTextEditorDecorationType({
                after: {
                    contentText: `${valueChange}`,
                    fontStyle: 'italic bold',
                    color: new vscode.ThemeColor('editorInlayHint.foreground'),
                    backgroundColor: new vscode.ThemeColor('editorInlayHint.background'),
                    margin: '8px 8px 8px 8px',
                    textDecoration: `border: 1px solid ${new vscode.ThemeColor('editorWidget.border')}; border-radius: 8px;`,
                }
            });
            this.decorationTypes.set(variable.name, decorationType);
        }

        // For each variable, find all occurrences
        for (const variable of variables) {
            // Skip the variable that is not in the valueChangeMap
            const valueChange = valueChangeMap.get(variable.name);
            if (!valueChange) { continue; }

            const position = variable.selectionRange.start;
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                position
            );
            if (references) {
                // Filter references within the module scope
                const filteredReferences = references.filter(
                    ref => ref.uri.toString() === document.uri.toString() &&
                        moduleRange.contains(ref.range)
                );

                // Store ranges for each variable
                this.variableRanges.set(variable.name, filteredReferences.map(ref => ref.range));
            }
        }
        // Apply decorations
        for (const [variableName, ranges] of this.variableRanges) {
            const decorationType = this.decorationTypes.get(variableName);
            if (decorationType) {
                editor.setDecorations(decorationType, ranges);
            }
        }
    }
}