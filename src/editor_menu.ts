import * as vscode from 'vscode';

import { OpenedDesignsTreeProvider, HierarchyTreeProvider, ModuleInstancesTreeProvider, NetlistItem } from './tree_view';

function getWordAtCursor(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !(editor.document.languageId === 'verilog' || editor.document.languageId === 'systemverilog')) {
        return undefined;
    }

    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
    if (!wordRange) { return undefined; }

    const document = editor.document;
    const word = document.getText(wordRange);
    return word;
}

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
        if (!editor || !(editor.document.languageId === 'verilog' || editor.document.languageId === 'systemverilog')) {
            return;
        }
        const document = editor.document;
        // Get document symbols
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        if (!symbols) { return; }

        // Find all modules symbols
        const moduleSymbols = symbols.filter(
            symbol => symbol.kind === 9 /*=== vscode.SymbolKind.Module*/
        );
        if (!moduleSymbols) { return; }

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

    private async findVarItem(name: string): Promise<NetlistItem | undefined> {
        const activeInstance = this.hierarchyTreeProvider.getActiveDesign()?.getActiveInstance();
        if (!activeInstance) { return; }
        if (activeInstance.children.length === 0) {
            await this.hierarchyTreeProvider.getChildren(activeInstance);
        }
        // Find the child with the given name
        for (const child of activeInstance.children) {
            if (child.name === name) {
                return child;
            }
        }
        return undefined;
    }

    public async traceDriverOrLoad(traceDriver: boolean) {
        const symbol = getWordAtCursor();
        if (!symbol) { return; }

        const element = await this.findVarItem(symbol);
        if (!element) {
            vscode.window.showWarningMessage('Symbol not found: ' + symbol);
            return;
        }

        await this.hierarchyTreeProvider.getDriversAndLoads(element);
        await this.hierarchyTreeProvider.setDriversLoadsData(element);

        const children = traceDriver ? element.drivers : element.loads;

        if (children.length === 0) {
            if (traceDriver) {
                vscode.window.showWarningMessage('No driver found for: ' + symbol);
            } else {
                vscode.window.showWarningMessage('No load found for: ' + symbol);
            }
            return;
        }

        // If there is only one driver/load, go to it
        if (children.length === 1) {
            await this.hierarchyTreeProvider.gotoDefinition(children[0]);
            return;
        }

        // If there are multiple drivers/loads, focus on the drivers/loads view
        const viewName = traceDriver ? 'driversView' : 'loadsView';
        vscode.commands.executeCommand(`${viewName}.focus`);
    }

    public async showInHierarchyView() { // TODO: handle module/check is variable
        const symbol = getWordAtCursor();
        if (!symbol) { return; }

        const element = await this.findVarItem(symbol);
        if (element) {
            this.hierarchyView.reveal(element, { select: true, focus: false, expand: 3 });
            return;
        }
        vscode.window.showWarningMessage('Symbol not found: ' + symbol);
    }

    private async getHierarchyName(): Promise<string | undefined> {
        const symbol = getWordAtCursor();
        if (!symbol) { return; }
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
    if (!editor || !(editor.document.languageId === 'verilog' || editor.document.languageId === 'systemverilog')) {
        return;
    }

    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
    if (!wordRange) { return; }

    const position = wordRange.start;

    // Get document symbols
    const symbols = await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        editor.document.uri
    );

    // console.log(symbols);
    if (!symbols) { return; }

    // Find the module by name
    const moduleSymbol = findModuleSymbol(symbols, moduleName);
    if (!moduleSymbol) { return; }

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