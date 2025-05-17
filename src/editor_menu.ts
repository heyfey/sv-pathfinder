import * as vscode from 'vscode';

import { OpenedDesignsTreeProvider, HierarchyTreeProvider, ModuleInstancesTreeProvider, NetlistItem } from './tree_view';

export class EditorMenuProvider {

    constructor(
        private readonly designProvider: OpenedDesignsTreeProvider,
        private readonly hierarchyView: vscode.TreeView<NetlistItem>,
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly moduleInstancesView: vscode.TreeView<NetlistItem>,
        private readonly moduleInstancesTreeProvider: ModuleInstancesTreeProvider,
    ) {
    }

    public async selectInstance() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'verilog') {
            return;
        }
        const document = editor.document;
        // Get document symbols
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        if (!symbols) {
            return;
        }
        // Find all modules symbols
        const moduleSymbols = symbols.filter(
            symbol => symbol.kind === 9 /*=== vscode.SymbolKind.Module*/
        );
        if (!moduleSymbols) {
            return;
        }

        const position = editor.selection.active;
        // Find which module the cursor is in
        const moduleSymbol = moduleSymbols.find(
            symbol => symbol.range.contains(position)
        );
        if (!moduleSymbol) {
            vscode.window.showWarningMessage('Cursor not in a module.');
            return;
        }

        // Reveal the target module
        const modules = await this.moduleInstancesTreeProvider.getChildren();
        if (!modules) {
            vscode.window.showWarningMessage('Module not found: ' + moduleSymbol.name);
            return;
        }
        for (const module of modules) {
            if (module.label === moduleSymbol.name) {
                this.moduleInstancesView.reveal(module, { select: true, focus: false, expand: 3 });
                return;
            }
        }
        vscode.window.showWarningMessage('Module not found: ' + moduleSymbol.name);
    }

    public async traceDriver() {
        vscode.window.showWarningMessage('NYI');
    }

    public async traceLoad() {
        vscode.window.showWarningMessage('NYI');
    }

    public async showInHierarchyView() { // TODO: handle module/check is variable
        // TODO: not working if select instance from moduleInstancesView
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'verilog') { return; }

        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (!wordRange) { return; }

        const document = editor.document;
        const symbol = document.getText(wordRange);

        const activeInstance = this.hierarchyTreeProvider.getActiveDesign()?.getActiveInstance();
        if (!activeInstance) { return; }
        if (activeInstance.children.length === 0) {
            await this.hierarchyTreeProvider.getChildren(activeInstance);
        }
        // find and reveal the child with the same label as the symbol
        for (const child of activeInstance.children) {
            if (child.label === symbol) {
                this.hierarchyView.reveal(child, { select: true, focus: false, expand: 3 });
                return;
            }
        }
        vscode.window.showWarningMessage('Symbol not found: ' + symbol);
    }

    private async getHierarchyName(): Promise<string | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'verilog') { return; }

        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (!wordRange) { return; }

        const document = editor.document;
        const symbol = document.getText(wordRange);
        const scopeName = this.hierarchyTreeProvider.getActiveDesign()?.getActiveScope();
        const hierarchyName = scopeName ? `${scopeName}.${symbol}` : symbol;
        return hierarchyName;
    }

    public async addToWaveformViewer() {
        const hierarchyName = await this.getHierarchyName();
        if (!hierarchyName) {
            return;
        }
        const activeDesign = this.hierarchyTreeProvider.getActiveDesign()!;
        this.designProvider.openWaveformIfNotPresent(activeDesign);
        const activeWaveform = activeDesign.getActiveWaveform();
        if (activeWaveform) {
            // Add to waveform viewer
            vscode.commands.executeCommand("waveformViewer.addVariable", { uri: activeWaveform.resourceUri.toString(), instancePath: hierarchyName });
        }
    }

    public async copyHierarchyName() {
        const hierarchyName = await this.getHierarchyName();
        if (!hierarchyName) {
            return;
        }
        // Copy to clipboard
        await vscode.env.clipboard.writeText(hierarchyName);
    }
}


export async function isCursorInModule(moduleName: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'verilog') { return; }

    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
    if (!wordRange) { return; }

    const position = wordRange.start;

    // const document = editor.document;
    // const symbol = document.getText(wordRange);
    // console.log(`Symbol: ${symbol}`);

    // Retrieve document symbols
    const symbols = await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        editor.document.uri
    );

    if (!symbols) { return; }
    // console.log(symbols);

    // Find the module by name
    const moduleSymbol = findModuleSymbol(symbols, moduleName);
    if (!moduleSymbol) {
        return; // Module not found
    }

    return Promise.resolve(moduleSymbol.range.contains(position));
}

function findModuleSymbol(symbols: any, moduleName: string) {
    for (const symbol of symbols) {
        // Module == 9 , Variable == 12 or 7. Need to test more verilog language servers.
        if (symbol.kind === 9 /*=== vscode.SymbolKind.Module*/ && symbol.name === moduleName) {
            return symbol;
        }
        // Recursively search in children. Only needed if modules inside module is possible.
        // if (symbol.children) {
        //     const found = findModuleSymbol(symbol.children, moduleName);
        //     if (found) {
        //         return found;
        //     }
        // }
    }
    return null;
}