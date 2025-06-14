import * as vscode from 'vscode';

import { HierarchyTreeProvider, NetlistItem } from './tree_view';

import * as treeSitter from "web-tree-sitter";
const VerilogWasmPath = '/home/heyfey/git-repos/sv-pathfinder/parser/tree-sitter-verilog.wasm';
// const VhdlWasmPath = '/home/heyfey/git-repos/sv-pathfinder/parser/tree-sitter-vhdl.wasm';
const fs = require('fs');

// In vscode definition, vscode.SymbolKind.Module === 1
// However, the SymbolKind for verilog module turns out depends on the
// language server used. For example:
//  4 in svlangserver
//  5 in Verible
//  9 in SystemVerilog - Language Support
// Using SystemVerilog - Language Support here
const SymbolKindModule = 9;

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

    private verilogParser: any;
    private verilogLanguage: any;
    // private vhdlParser: any;

    constructor(
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
    ) {
        // Initialize the debounce timer
        this.debounceTimer = setTimeout(() => { }, 0);
        this.createParser();
    }

    private async createParser() {
        await treeSitter.Parser.init();
        this.verilogParser = new treeSitter.Parser();
        this.verilogLanguage = await treeSitter.Language.load(VerilogWasmPath);
        this.verilogParser.setLanguage(this.verilogLanguage);
        console.log(this.verilogParser);

        await this.testParser();
    }

    private async testParser() {
        let filePath = "/home/heyfey/waveform/Design/BJsource.v";
        filePath = "/home/heyfey/waveform/Design/tb_CPUsystem.v";
        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const tree = this.verilogParser.parse(sourceCode);
        // console.log(tree.rootNode.toString());
        // this.traverse(tree.rootNode, 0);
        const targetModule = await this.findModuleNode(tree, 'tb_CPUsystem');
        // console.log(targetModule ? `Found module: ${targetModule.text}` : "Module not found.");
        this.findNodesUnderModule(targetModule);
    }

    private traverse(node: any, depth: number = 0) {
        const indent = ' '.repeat(depth * 2);
        console.log(`[${depth}]${indent}Node type: ${node.type}, text: ${node.text}, start: ${node.startPosition.row}:${node.startPosition.column}, end: ${node.endPosition.row}:${node.endPosition.column}`);
        for (const child of node.namedChildren) {
            this.traverse(child, depth + 1);
        }
    }

    private findModuleNode(tree: treeSitter.Tree, moduleName: string) {
        const query = new treeSitter.Query(this.verilogLanguage, `
            (module_declaration
                (module_header
                    (simple_identifier) @name
                    (#eq? @name "${moduleName}")
                )
            ) @module
          `);

        const matches = query.matches(tree.rootNode);
        if (matches.length === 0) {
            console.log(`Module '${moduleName}' not found.`);
            return;
        }
        const moduleCapture = matches[0].captures.find(c => c.name === 'module');
        return moduleCapture ? moduleCapture.node : undefined;
    }

    private findNodesUnderModule(moduleNode: treeSitter.Node | undefined): treeSitter.Node[] {
        if (!moduleNode) { return []; }
        // Exclude certain parent types to collect only identifiers for variables and ports.
        // Note: The parent types are based on the tree-sitter-verilog grammar.
        const excludedParentTypes = ['module_header', 'module_instantiation', 'instance_identifier', 'port_identifier'];
        return this.collectFilteredIdentifiers(moduleNode, excludedParentTypes);
    }

    private collectFilteredIdentifiers(node: treeSitter.Node, excludedParentTypes: string[]): treeSitter.Node[] {
        // There are two ways to collect identifiers:
        // 1. Using tree-sitter query
        // 2. Using tree-sitter cursor
        // Not sure which is faster.
        return this.collectFilteredIdentifiersQuery(node, excludedParentTypes);
        // return this.collectFilteredIdentifiersCursor(node, excludedParentTypes);
    }

    private collectFilteredIdentifiersQuery(node: treeSitter.Node, excludedParentTypes: string[]): treeSitter.Node[] {
        const query = new treeSitter.Query(this.verilogLanguage, `(simple_identifier) @id`);
        const matches = query.matches(node);

        const filteredIds = matches.filter(match => {
            const node = match.captures[0].node;
            const parent = node.parent;
            return parent && !excludedParentTypes.includes(parent.type);
        });
        const identifiers = filteredIds.map(match => match.captures[0].node);
        // console.log(identifiers.map(id => id.text));
        return identifiers;
    }

    private collectFilteredIdentifiersCursor(node: treeSitter.Node, excludedParentTypes: string[]): treeSitter.Node[] {
        const identifiers: treeSitter.Node[] = [];
        const cursor = node.walk();
        let visiting = true;

        // Can we only visit the named children?
        while (visiting) {
            const current = cursor.currentNode;
            // console.log(`Visiting node: ${current.type}, text: ${current.text}`);
            if (current.type === 'simple_identifier' &&
                current.parent &&
                !excludedParentTypes.includes(current.parent.type)) {
                identifiers.push(current);
            }
            if (cursor.gotoFirstChild()) { continue; }
            if (cursor.gotoNextSibling()) { continue; }
            do {
                if (!cursor.gotoParent()) {
                    visiting = false;
                    break;
                }
            } while (!cursor.gotoNextSibling());
        }
        // console.log(identifiers.map(id => id.text));
        return identifiers;
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
        // Clear all existing decorations
        for (const decorationType of this.decorationTypesMap.values()) {
            decorationType.dispose();
        }
        // Clear all cached results
        this.decorationTypesMap.clear();
        this.rangesMap.clear();

        // Get metadata from the active design
        const activeDesign = this.hierarchyTreeProvider.getActiveDesign();
        if (!activeDesign) { return; }

        const activeModule = activeDesign.getActiveModule();
        if (!activeModule) { return; }

        const activeWaveform = activeDesign.getActiveWaveform();
        if (!activeWaveform) { return; }

        // const tree = this.verilogParser.parse(editor.document.getText());
        // console.log(tree);

        const document = editor.document;
        // Get symbols from the document
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        if (!symbols) { return; }

        // Find the module symbol
        const moduleSymbol = symbols.find(
            symbol => symbol.name === activeModule && symbol.kind === SymbolKindModule
        );
        if (!moduleSymbol) {
            return;
        }
        const moduleRange = moduleSymbol.range;
        this.targetFile = document.uri.fsPath; // TODO: use source file in NetlistItem

        // Get all unique variables within the module
        const variables = [];
        const nameSet = new Set();
        for (const child of moduleSymbol.children) {
            if ((child.kind === vscode.SymbolKind.Variable || child.kind === vscode.SymbolKind.Field)
                && !nameSet.has(child.name)) {
                nameSet.add(child.name);
                variables.push(child);
            }
        }

        // Get instance paths for variables
        const scopeName = activeDesign.getActiveScope();
        const instancePaths = [];
        for (const variable of variables) {
            const instancePath = scopeName + '.' + variable.name;
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

        // Store [variableName, decorationType] in a map
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

        // For each variable, find all occurrences and store them in a map: [variableName, vscode.Range[]]
        for (const variable of variables) {
            // Skip the variable that didn't found in the waveform viewer
            if (!waveformValueMap.get(variable.name)) { continue; }

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
                this.rangesMap.set(variable.name, filteredReferences.map(ref => ref.range));
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
}