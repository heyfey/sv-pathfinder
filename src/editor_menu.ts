import * as vscode from 'vscode';

import { OpenedDesignsTreeProvider, HierarchyTreeProvider, NetlistItem, DesignItem, showModulesViewEnabled } from './tree_view';
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
        private readonly parser: Parser,
    ) {
    }

    public async selectInstance() {
        const design = this.hierarchyTreeProvider.getActiveDesign();
        if (!design) { vscode.window.showInformationMessage('Open and select a design first.'); return; }

        const moduleName = await this.parser.getModuleAtCursor();
        if (!moduleName) {
            vscode.window.showInformationMessage('Place the cursor inside a module to select its instance.');
            return;
        }
        if (!showModulesViewEnabled()) {
            vscode.window.showInformationMessage('Enable the Modules view to select instances, or pick one in the Hierarchy view.');
            return;
        }

        const instances = await this.getInstancesOfModule(design, moduleName);
        if (instances.length === 0) {
            vscode.window.showInformationMessage(`No instance of '${moduleName}' found in the design.`);
            return;
        }
        if (instances.length === 1) {
            // Exactly one instance → make it active and reveal it in the Hierarchy view.
            await this.hierarchyTreeProvider.revealScopeInHierarchy(instances[0]);
            return;
        }
        // Several instances → reveal the module in the Modules view so the user can pick.
        await this.revealModuleInModulesView(design, moduleName);
    }

    // #region scope resolution (always-enabled editor commands)
    // Resolve the hierarchy scope an editor command should act on, for the module under the
    // cursor. Returns the active instance when its module matches, otherwise the cursor module's
    // single instance (mapped to its hierarchy node) — WITHOUT changing the active scope. Shows
    // guidance and returns undefined when it can't resolve.
    public async resolveScopeForCursorModule(): Promise<NetlistItem | undefined> {
        const design = this.hierarchyTreeProvider.getActiveDesign();
        if (!design) { vscode.window.showInformationMessage('Open and select a design first.'); return undefined; }

        const cursorModule = await this.parser.getModuleAtCursor();
        if (!cursorModule) { vscode.window.showInformationMessage('Place the cursor inside a module to use this command.'); return undefined; }

        // Active scope already an instance of the cursor's module → use it as-is.
        if (design.getActiveModule() === cursorModule) { return design.getActiveInstance(); }

        // Can't enumerate the module's instances without the Modules view → ask for a manual pick.
        if (!showModulesViewEnabled()) {
            vscode.window.showInformationMessage(`The active scope is not an instance of '${cursorModule}'. Select an instance in the Hierarchy view first.`);
            return undefined;
        }

        const instances = await this.getInstancesOfModule(design, cursorModule);
        if (instances.length === 0) {
            vscode.window.showInformationMessage(`No instance of '${cursorModule}' found in the design.`);
            return undefined;
        }
        if (instances.length > 1) {
            await this.revealModuleInModulesView(design, cursorModule);
            vscode.window.showInformationMessage(`'${cursorModule}' has ${instances.length} instances — select one in the Modules view first.`);
            return undefined;
        }

        // Exactly one instance → map the Modules-view instance to its hierarchy node.
        const scope = await design.findTreeItem(instances[0].fullName);
        if (!scope) {
            vscode.window.showWarningMessage(`Could not locate an instance of '${cursorModule}' in the hierarchy.`);
            return undefined;
        }
        return scope;
    }

    // Instances of a module, via the Modules-view data (no active-scope change).
    private async getInstancesOfModule(design: DesignItem, moduleName: string): Promise<NetlistItem[]> {
        const moduleDef = design.getModuleInstances().find(m => m.name === moduleName);
        if (!moduleDef) { return []; }
        return (await design.getModuleInstancesExternal(moduleDef)) ?? [];
    }

    private async revealModuleInModulesView(design: DesignItem, moduleName: string): Promise<void> {
        const moduleDef = design.getModuleInstances().find(m => m.name === moduleName);
        if (moduleDef) {
            await this.moduleInstancesView.reveal(moduleDef, { select: true, focus: true, expand: 3 });
        }
    }

    // Find a variable by name among a scope's (lazily-loaded) hierarchy children.
    private async findVarItem(name: string, scope: NetlistItem): Promise<NetlistItem | undefined> {
        if (scope.children.length === 0) {
            await this.hierarchyTreeProvider.getChildren(scope);
        }
        return scope.children.find(child => child.name === name);
    }

    public async traceDriverOrLoad(traceDriver: boolean) {
        const symbol = getWordAtCursor();
        if (!symbol) { return; }

        const scope = await this.resolveScopeForCursorModule();
        if (!scope) { return; }

        const element = await this.findVarItem(symbol, scope);
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

        const scope = await this.resolveScopeForCursorModule();
        if (!scope) { return; }

        const element = await this.findVarItem(symbol, scope);
        if (element) {
            this.hierarchyView.reveal(element, { select: true, focus: false, expand: 3 });
            return;
        }
        vscode.window.showWarningMessage('Symbol not found: ' + symbol);
    }

    private getHierarchyName(design: DesignItem, scope: NetlistItem, symbol: string): string {
        return `${design.scopePathOf(scope)}.${symbol}`;
    }

    public async addToWaveformViewer() {
        const symbol = getWordAtCursor();
        if (!symbol) { return; }

        const scope = await this.resolveScopeForCursorModule();
        if (!scope) { return; }

        const design = this.hierarchyTreeProvider.getActiveDesign()!;
        const hierarchyName = this.getHierarchyName(design, scope, symbol);
        await this.designProvider.openWaveformIfNotPresent(design);
        const activeWaveform = design.getActiveWaveform();
        if (activeWaveform) {
            // Show in waveform viewer: reveal:true selects an already-displayed signal instead of
            // adding a duplicate row.
            vscode.commands.executeCommand("waveformViewer.addVariable", { uri: activeWaveform.resourceUri.toString(), instancePath: hierarchyName, reveal: true });
        }
    }

    public async copyHierarchyName() {
        const symbol = getWordAtCursor();
        if (!symbol) { return; }

        const scope = await this.resolveScopeForCursorModule();
        if (!scope) { return; }

        const design = this.hierarchyTreeProvider.getActiveDesign()!;
        await vscode.env.clipboard.writeText(this.getHierarchyName(design, scope, symbol));
    }
}