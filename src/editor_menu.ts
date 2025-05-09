import * as vscode from 'vscode';

import { HierarchyTreeProvider, ModuleInstancesTreeProvider, NetlistItem } from './tree_view';

export class EditorMenuProvider {

    constructor(
        private readonly hierarchyView: vscode.TreeView<NetlistItem>,
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly moduleInstancesTreeProvider: ModuleInstancesTreeProvider,
    ) {
    }

    public async selectInstance() {
        vscode.window.showWarningMessage('NYI');
    }

    public async traceDriver() {
        vscode.window.showWarningMessage('NYI');
    }

    public async traceLoad() {
        vscode.window.showWarningMessage('NYI');
    }

    public async showInHierarchyView() { // TODO: handle module/check is variable
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

    public async showInWaveform() {
        vscode.window.showWarningMessage('NYI');
    }

    public async copyHierarchyName() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'verilog') { return; }

        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (!wordRange) { return; }

        const document = editor.document;
        const symbol = document.getText(wordRange);
        const scopeName = this.hierarchyTreeProvider.getActiveDesign()?.getActiveScope();
        const hierarchyName = scopeName ? `${scopeName}.${symbol}` : symbol;

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