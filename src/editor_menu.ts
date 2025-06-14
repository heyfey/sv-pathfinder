import * as vscode from 'vscode';

import { OpenedDesignsTreeProvider, HierarchyTreeProvider, ModuleInstancesTreeProvider, NetlistItem } from './tree_view';
import { Parser } from './parser';

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
        private readonly parser: Parser,
    ) {
    }

    public async selectInstance() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !(editor.document.languageId === 'verilog' || editor.document.languageId === 'systemverilog')) {
            return;
        }

        const moduleName = await this.parser.getModuleAtCursor();
        if (!moduleName) {
            vscode.window.showWarningMessage('Cursor not in a module.');
            return;
        }
        // Reveal the target module
        const modules = await this.moduleInstancesTreeProvider.getChildren();
        if (!modules) {
            vscode.window.showWarningMessage('Module not found: ' + moduleName);
            return;
        }
        for (const module of modules) {
            if (module.name === moduleName) {
                this.moduleInstancesView.reveal(module, { select: true, focus: false, expand: 3 });
                return;
            }
        }
        vscode.window.showWarningMessage('Module not found: ' + moduleName);
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