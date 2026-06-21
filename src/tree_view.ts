import * as vscode from 'vscode';
import path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as cp from 'child_process';
import * as slang from './slang_server/SlangInterface'
import { absolutizeFlist } from './flist';
import { isNoOpNavigation, findColumnForPath } from './nav_history';
import { resolveRenamedBool } from './settings_util';
import { InstanceSearchResult, InstanceSearchHits, InstanceQuickPickItem, toInstanceQuickPickItems, filterAndCapInstances } from './design_search';

// Whether the "Modules" view is enabled. The setting was renamed showInstancesView → showModulesView;
// honor the old key for users who set it before the rename.
export function showModulesViewEnabled(): boolean {
    const cfg = vscode.workspace.getConfiguration('sv-pathfinder');
    const userSet = (key: string) => {
        const i = cfg.inspect<boolean>(key);
        return i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue;
    };
    return resolveRenamedBool(userSet('showModulesView'), userSet('showInstancesView'), true);
}

// Must use require instead of import somehow
let kuzu: any | undefined; // require("kuzu");

// Scopes — icon set aligned with VaporView (one scope color for all scope kinds).
const scopeColor = new vscode.ThemeColor('charts.purple');
const moduleIcon = new vscode.ThemeIcon('chip', scopeColor);
const taskIcon = new vscode.ThemeIcon('debug-stackframe', scopeColor);
const funcIcon = new vscode.ThemeIcon('symbol-module', scopeColor);
const beginIcon = new vscode.ThemeIcon('debug-start', scopeColor);
const forkIcon = new vscode.ThemeIcon('repo-forked', scopeColor);
const structIcon = new vscode.ThemeIcon('symbol-structure', scopeColor);
const unionIcon = new vscode.ThemeIcon('surround-with', scopeColor);
const classIcon = new vscode.ThemeIcon('symbol-misc', scopeColor);
const interfaceIcon = new vscode.ThemeIcon('debug-disconnect', scopeColor);
const packageIcon = new vscode.ThemeIcon('package', scopeColor);
const scopeIcon = new vscode.ThemeIcon('symbol-module', scopeColor);
// sv-pathfinder extras (not in VaporView's scheme): a Modules-view def, modports, clocking blocks.
const moduleDefIcon = new vscode.ThemeIcon('symbol-enum');
const modportIcon = new vscode.ThemeIcon('plug', new vscode.ThemeColor('charts.orange'));
const clockIcon = new vscode.ThemeIcon('watch', scopeColor);

export function createScope(fullName: string, type: string, file: string, lineNumber: number, columnNumber: number, moduleName: string, contextValue: string, parent: NetlistItem | undefined, handle: any | undefined) {

    let icon = scopeIcon;
    const typename = type.toLocaleLowerCase();
    switch (typename) {
        case 'module': { icon = moduleIcon; break; }
        case 'task': { icon = taskIcon; break; }
        case 'function': { icon = funcIcon; break; }
        case 'begin': { icon = beginIcon; break; }
        case 'fork': { icon = forkIcon; break; }
        case 'generate': { icon = scopeIcon; break; }
        case 'struct': { icon = structIcon; break; }
        case 'union': { icon = unionIcon; break; }
        case 'class': { icon = classIcon; break; }
        case 'interface': { icon = interfaceIcon; break; }
        case 'interfacearray': { icon = interfaceIcon; break; }
        case 'package': { icon = packageIcon; break; }
        case 'program': { icon = scopeIcon; break; }
        case 'vhdlarchitecture': { icon = scopeIcon; break; }
        case 'vhdlprocedure': { icon = taskIcon; break; }
        case 'vhdlfunction': { icon = funcIcon; break; }
        case 'vhdlrecord': { icon = scopeIcon; break; }
        case 'vhdlprocess': { icon = scopeIcon; break; }
        case 'vhdlblock': { icon = scopeIcon; break; }
        case 'vhdlforgenerate': { icon = scopeIcon; break; }
        case 'vhdlifgenerate': { icon = scopeIcon; break; }
        case 'vhdlgenerate': { icon = scopeIcon; break; }
        case 'vhdlpackage': { icon = packageIcon; break; }
        case 'ghwgeneric': { icon = scopeIcon; break; }
        case 'vhdlarray': { icon = scopeIcon; break; }
        case 'moduledef': { icon = moduleDefIcon; break; }
        case 'modport': { icon = modportIcon; break; }
        case 'clockingblock': { icon = clockIcon; break; }
        case 'scope': { icon = scopeIcon; break; } // for slang
        case 'scopearray': { icon = scopeIcon; break; } // for slang
        case 'instancearray': { icon = moduleIcon; break; } // for slang
    }

    // Hack for Modules view
    if (contextValue === 'moduleDefItem') {
        icon = new vscode.ThemeIcon(icon.id, new vscode.ThemeColor('charts.orange'));
    }
    let collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    if (contextValue === 'instanceItem') {
        collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    const module = new NetlistItem(fullName, typename, 0, file, lineNumber, columnNumber, moduleName, contextValue, parent, [], handle, collapsibleState);
    module.iconPath = icon;

    return module;
}

// Variables
// Variables — icon set aligned with VaporView.
const chartsGreen = new vscode.ThemeColor('charts.green');
const regIcon = new vscode.ThemeIcon('symbol-array', chartsGreen);
const wireIcon = new vscode.ThemeIcon('symbol-interface', chartsGreen);
const intIcon = new vscode.ThemeIcon('symbol-variable', chartsGreen);
const paramIcon = new vscode.ThemeIcon('settings', new vscode.ThemeColor('charts.blue'));
const realIcon = new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.orange'));
const defaultIcon = new vscode.ThemeIcon('file-binary', chartsGreen);
const stringIcon = new vscode.ThemeIcon('symbol-key', new vscode.ThemeColor('charts.yellow'));
const portIcon = new vscode.ThemeIcon('plug', chartsGreen);
const timeIcon = new vscode.ThemeIcon('watch', chartsGreen);
const enumIcon = new vscode.ThemeIcon('symbol-parameter', chartsGreen);
const variableIcon = new vscode.ThemeIcon('symbol-variable', chartsGreen);

export function createVar(fullName: string, type: string, width: number, file: string, lineNumber: number, columnNumber: number, moduleName: string, contextValue: string, parent: NetlistItem | undefined) {
    //   const field = bitRangeString(msb, lsb);

    // field is already included in signal name for fsdb
    //   if (!isFsdb) name = name + field;

    const variable = new NetlistItem(fullName, type, width, file, lineNumber, columnNumber, moduleName, contextValue, parent, [], vscode.TreeItemCollapsibleState.None);
    const typename = type.toLocaleLowerCase();
    let icon;

    switch (typename) {
        case 'event': { icon = defaultIcon; break; }
        case 'integer': { icon = intIcon; break; }
        case 'parameter': { icon = paramIcon; break; }
        case 'real': { icon = realIcon; break; }
        case 'reg': { icon = defaultIcon; break; }
        case 'supply0': { icon = defaultIcon; break; }
        case 'supply1': { icon = defaultIcon; break; }
        case 'time': { icon = timeIcon; break; }
        case 'tri': { icon = defaultIcon; break; }
        case 'triand': { icon = defaultIcon; break; }
        case 'trior': { icon = defaultIcon; break; }
        case 'trireg': { icon = defaultIcon; break; }
        case 'tri0': { icon = defaultIcon; break; }
        case 'tri1': { icon = defaultIcon; break; }
        case 'wand': { icon = defaultIcon; break; }
        case 'wire': { icon = wireIcon; break; }
        case 'wor': { icon = defaultIcon; break; }
        case 'string': { icon = stringIcon; break; }
        case 'port': { icon = portIcon; break; }
        case 'sparsearray': { icon = defaultIcon; break; }
        case 'realtime': { icon = timeIcon; break; }
        case 'realparameter': { icon = paramIcon; break; }
        case 'bit': { icon = defaultIcon; break; }
        case 'logic': { icon = defaultIcon; break; }
        case 'int': { icon = intIcon; break; }
        case 'shortint': { icon = intIcon; break; }
        case 'longint': { icon = intIcon; break; }
        case 'byte': { icon = defaultIcon; break; }
        case 'enum': { icon = enumIcon; break; }
        case 'shortreal': { icon = defaultIcon; break; }
        case 'boolean': { icon = defaultIcon; break; }
        case 'bitvector': { icon = defaultIcon; break; }
        case 'stdlogic': { icon = defaultIcon; break; }
        case 'stdlogicvector': { icon = defaultIcon; break; }
        case 'stdulogic': { icon = defaultIcon; break; }
        case 'stdulogicvector': { icon = defaultIcon; break; }
        case 'net': { icon = wireIcon; break; }
        case 'variable': { icon = variableIcon; break; }
        case 'instance': { icon = moduleIcon; break; } // for module instance
    }

    variable.iconPath = icon;
    if ((typename === 'wire') || (typename === 'reg') || (typename === 'net') || (icon === defaultIcon)) {
        if (width > 1) { variable.iconPath = regIcon; }
        else { variable.iconPath = wireIcon; }
    }

    return variable;
}

// #region NetlistItem
export class NetlistItem extends vscode.TreeItem {
    public readonly name: string;
    public readonly modulePath: string;
    public readonly command: vscode.Command;

    // Only used by variables
    public drivers: NetlistItem[] = [];
    public loads: NetlistItem[] = [];

    constructor(
        public readonly fullName: string,
        public readonly type: string,
        public readonly width: number,
        public readonly sourceFile: string,
        public readonly lineNumber: number,
        public readonly columnNumber: number,
        public readonly moduleName: string,
        public readonly contextValue: string,
        public readonly parent: NetlistItem | undefined,
        public children: NetlistItem[] = [],
        public readonly handle: any | undefined, // only used by UHDM for instance handles
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        fullName = fullName.replace("work@", ""); // remove prefix for UHDM

        const parts = fullName.split('.');
        const name = parts.pop() || '';
        let label = fullName;
        if (contextValue === 'varItem' || contextValue === 'scopeItem') {
            label = name;
        }
        if (contextValue === 'varItem' && width > 1) {
            label = name + "[" + (width - 1) + ":0]"; // TODO: fix hard-coded bit range
        }
        super(label, collapsibleState);

        this.name = name;

        this.modulePath = parts.join('.');
        if (this.contextValue === 'moduleDefItem') { this.modulePath = ''; }

        this.command = {
            command: 'sv-pathfinder.gotoDefinition',
            title: 'Go to definition',
            arguments: [this],
        };

        this.tooltip = `Name: ${this.fullName}`;
        this.tooltip += `\nType: ${this.type}`;
        // For debug
        // this.tooltip += `\n contextValue:  ${this.contextValue}\n Name: ${this.name}\n Module: ${this.moduleName}\n modulePath: file: ${this.modulePath}\n ${this.sourceFile}\n line: ${this.lineNumber}${this.columnNumber > 0 ? `, column: ${this.columnNumber}` : ''}\n witdh: ${this.width}`;
    }

    getHierarchyName(): string {
        let result = "";
        if (this.modulePath !== "") { result += this.modulePath + "."; }
        if (this.name) { result += this.name; }
        return result;
    }

    // Method to recursively find a child element in the tree
    async findChild(fullName: string, design: DesignItem): Promise<NetlistItem | undefined> {
        // If the fullName is empty, return the current item
        if (fullName === '') {
            return this;
        }

        const subModules = fullName.split(".");
        const currentModule = subModules.shift();
        if (this.children.length === 0) {
            await design.getChildrenExternal(this);
        }

        const childItem = this.children.find((child) => {
            // Special handling for slang scopearray and instancearray, as
            // it's layouted like this in tree:
            // module: top
            //     scopearray: gen_mc -> top.gen_mc (only slang has this)
            //         scope: gen_mc[0] -> top.gen_mc[0]
            //         scope: gen_mc[1] -> top.gen_mc[1]
            //
            // (Actually we don't need to findTreeItem if already store instLoc in
            //     NetlistItem, which could be retrieved directly from slang)
            if (child.type === 'scopearray' || child.type === 'instancearray') {
                // remove bit range from name
                const regex = /\[(\d+:)?(\d+)\]$/;
                const currentModule2 = currentModule?.replace(regex, '');
                return child.name === currentModule2;
            }

            // Normal case
            return child.name === currentModule;
        });

        if (childItem) {
            // No need to shift 1 when searching in slang scopearray and instancearray
            if (childItem.type === 'scopearray' || childItem.type === 'instancearray') {
                return await childItem.findChild(fullName, design);
            }
            return await childItem.findChild(subModules.join("."), design);
        } else {
            return undefined;
        }
    }

    async getAllChildVarsNames(design: DesignItem): Promise<string[]> {
        let names: string[] = [];
        if (this.contextValue !== 'scopeItem') { return names; }
        if (this.children.length === 0) {
            await design.getChildrenExternal(this);
        }
        for (const child of this.children) {
            // TODO: recursively add variables in generated blocks, modports, etc.
            if (child.contextValue === 'varItem' && child.type !== 'parameter') {
                names.push(child.getHierarchyName());
            }
        }
        return names;
    }

    public resetWaveformValuesDescriptions() {
        if (this.children.length === 0) { return; }
        // Assume children are already loaded
        for (const child of this.children) {
            // Strip any "= value" annotation back to the base name. Only touch string descriptions:
            // a var that was never annotated has an undefined description, and splitting that yields
            // an empty array whose [0] is undefined -> `.trim()` would throw (crashed go-to-source
            // from the schematic, which resets the previously-active scope).
            if (child.contextValue === 'varItem' && child.type !== 'parameter'
                && typeof child.description === 'string') {
                child.description = child.description.split('=')[0].trim();
            }
        }
    }
}

// #region WaveformItem
class WaveformItem extends vscode.TreeItem {
    public readonly contextValue = 'waveformItem';
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly design: DesignItem,
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        const filePath = resourceUri.fsPath;
        const filename = path.basename(filePath); // "test.vcd"
        const extension = path.extname(filePath); // ".vcd"
        const directory = path.dirname(filePath); // "/home/me"
        const label = filename;
        super(label, collapsibleState);
        this.description = directory;
        // get icon path from extension
        if (extension === '.vcd' || extension === '.fst' || extension === '.ghw') {
            this.iconPath = path.join(__dirname, '..', 'media', 'wavedump_file_icon.svg');
        } else if (extension === '.fsdb') {
            this.iconPath = path.join(__dirname, '..', 'media', 'wavedump_file_icon_fsdb.svg');
        }

        this.command = {
            command: 'vaporview.openFile',
            title: 'Open Waveform',
            arguments: [{ uri: this.resourceUri }],
        };

        this.tooltip = filePath;
        this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
    }
}

interface gotoContext {
    element: NetlistItem;
    action: string;
}

// #region DesignItem
export abstract class DesignItem extends vscode.TreeItem {
    contextValue = 'designItem';
    public iconPath = new vscode.ThemeIcon('file-directory');
    readonly resourceUri: vscode.Uri;
    private activeInstance?: NetlistItem | undefined;
    readonly command: vscode.Command;
    // Hierarchy tree
    protected treeData: NetlistItem[] = [];
    // For go back and forward
    public lastContext: gotoContext | undefined = undefined;
    public backwardStack: gotoContext[] = [];
    public forwardStack: gotoContext[] = [];
    // Module Instances
    protected moduleInstances: NetlistItem[] = [];
    // Cached enumeration for the "find instance" picker (stable until the design is reloaded; the
    // backend's instance index only changes on recompile). Cleared in unloadTreeData().
    protected instanceSearchCache: InstanceSearchResult[] | undefined;

    // Waveform integration
    private waveforms: WaveformItem[] = [];
    private activeWaveform?: WaveformItem | undefined;

    readonly isExample: boolean;

    constructor(
        filePath: string,
        isExample: boolean,
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        const filename = path.basename(filePath); // "test.vcd"
        const extension = path.extname(filePath); // ".vcd"
        const directory = path.dirname(filePath); // "/home/me"
        const label = filename;
        super(label, collapsibleState);
        this.description = directory;
        this.resourceUri = vscode.Uri.file(filePath);
        this.isExample = isExample;

        this.command = {
            command: 'sv-pathfinder.selectDesign',
            title: 'Select Design',
            arguments: [this],
        };

        this.tooltip = filePath;
    }

    // Capped fuzzy search of the design's instances for the global "find instance" picker. Default:
    // not supported. Overridden per backend (slang JS-filters its cached enumeration; UHDM matches +
    // caps natively). Kept off the lazy tree — it asks the backend, it does not build TreeItems.
    public async searchInstances(_query: string, _maxResults: number): Promise<InstanceSearchHits> {
        return { total: 0, results: [] };
    }

    // Abstract methods to load treeData for different kinds of design databases
    public abstract load(): Promise<boolean>;
    public abstract unload(): Promise<void>;
    public abstract getChildrenExternal(element: NetlistItem | undefined): Promise<NetlistItem[]>;
    public abstract getDriversAndLoadsExternal(element: NetlistItem): Promise<void>;
    public abstract getModuleInstancesExternal(element: NetlistItem | undefined): Promise<NetlistItem[]>;
    public abstract getDefinitionFileLocation(element: NetlistItem): Promise<{ filePath: string; lineNumber: number, columnNumber: number }>

    public getTreeData(): NetlistItem[] { return this.treeData; }
    public getModuleInstances(): NetlistItem[] { return this.moduleInstances; }

    public unloadTreeData() {
        this.treeData = [];
        this.moduleInstances = [];
        this.instanceSearchCache = undefined; // re-enumerate after a reload (source may have changed)
        this.activeInstance = undefined;
        // this.waveforms = [];
        // this.activeWaveform = undefined;
        this.backwardStack = [];
        this.forwardStack = [];
    }

    public async reload() {
        await this.unload();
        await this.load();
    }

    // Set active instance based on different kinds of NetlistItem.
    // Returns true if active instance is changed.
    public async setActiveInstance(element: NetlistItem): Promise<boolean> {
        let instance;
        instance = element;
        if (element.contextValue === 'scopeItem') {
            instance = element;
        } else if (element.contextValue === 'varItem') {
            instance = element.parent!;
            // Find parent recursively until it is a module or interface
            if (instance.type !== 'module' && instance.type !== 'interface') {
                while (instance.parent && instance.type !== 'module' && instance.type !== 'interface') {
                    instance = instance.parent;
                }
            }
        } else if (element.contextValue === 'loadItem' || element.contextValue === 'driverItem') {
            // find tree item using modulePath
            const scope = await this.findTreeItem(element.modulePath);
            if (!scope) {
                console.log('[setActiveInstance] Cannot find in hierarchy tree: ' + element.fullName); // Should not happen
            } else {
                instance = scope;
            }
        } else if (element.contextValue === 'instanceItem') {
            const scope = await this.findTreeItem(element.fullName);
            if (!scope) {
                console.log('[setActiveInstance] Cannot find in hierarchy tree: ' + element.fullName); // Should not happen
            } else {
                instance = scope;
            }
        }
        if (this.activeInstance === instance) { return false; }
        this.activeInstance?.resetWaveformValuesDescriptions();
        this.activeInstance = instance;
        return true;
    }

    public getActiveInstance(): NetlistItem | undefined {
        return this.activeInstance;
    }

    // The hierarchy-path string for an instance/scope (e.g. "top.cpu.alu0"), the same form
    // getActiveScope() returns. Used to build instance paths for a resolved scope that isn't
    // necessarily the active one (editor commands acting on the cursor module's instance).
    public scopePathOf(instance: NetlistItem): string {
        let scope = instance.modulePath;
        if (instance.contextValue === 'scopeItem') {
            const label = typeof instance.label === 'string' ? instance.label : '';
            scope = scope === '' ? label : scope + '.' + label;
        } else if (instance.contextValue === 'instanceItem') {
            // Happen when we could not find scopeItem for instanceItem when setActiveInstance, thus fall back
            // to use instanceItem
            scope = instance.fullName;
        }
        return scope;
    }

    public getActiveScope(): string {
        return this.activeInstance ? this.scopePathOf(this.activeInstance) : '';
    }

    public getActiveModule(): string | undefined {
        return this.activeInstance?.moduleName;
    }

    public addWaveform(uri: vscode.Uri): WaveformItem | undefined {
        let index = this.waveforms.findIndex(waveform => waveform.resourceUri.fsPath === uri.fsPath);
        if (index < 0) {
            const waveform = new WaveformItem(uri, this, vscode.TreeItemCollapsibleState.None);
            this.waveforms.push(waveform);
            if (this.waveforms.length === 1) { // Set active if it's the only waveform
                this.setActiveWaveform(waveform);
                waveform.checkboxState = vscode.TreeItemCheckboxState.Checked;
                return waveform;
            }
        } else {
            return this.waveforms[index]; // Already exists, return existing waveform
        }
        return undefined;
    }

    public getWaveforms(): WaveformItem[] {
        return this.waveforms;
    }

    public setActiveWaveform(waveform: WaveformItem | undefined) {
        if (this.activeWaveform === waveform) { return; }
        this.activeWaveform = waveform;
    }

    public getActiveWaveform(): WaveformItem | undefined {
        return this.activeWaveform;
    }

    public async findTreeItem(fullName: string): Promise<NetlistItem | undefined> {
        // Tree node names are always clean (the NetlistItem ctor strips any UHDM "work@" prefix), so
        // callers must pass a clean hierarchy path here too.
        const element = this.treeData.find((element) => element.name === fullName.split('.')[0]);
        if (!element) { return undefined; }
        return await element.findChild(fullName.split('.').slice(1).join('.'), this);
    }
}

// #region KuzuDesignItem
class KuzuDesignItem extends DesignItem {
    // Kuzu database
    private db?: any/*kuzu.Database*/ | undefined;

    public async load(): Promise<boolean> {
        if (!kuzu) {
            try {
                kuzu = require("kuzu");
            } catch (error) {
                vscode.window.showErrorMessage('Failed to load Kuzu database addon: ' + error);
                return false;
            }
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Reading design database: " + this.resourceUri.fsPath,
                cancellable: false
            }, async () => {
                this.db = new kuzu.Database(this.resourceUri.fsPath, 0, true, true, 0);
                const conn = new kuzu.Connection(this.db);
                if (showModulesViewEnabled()) {
                    await this.loadModuleDefs(conn);
                }
                await this.loadTopModules(conn);
            });
            return true;
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load design database: ' + error);
            return false;
        }
    }

    private async loadModuleDefs(conn: any/*kuzu.Connection*/) {
        const query = `MATCH (m:ModuleDef) RETURN m;`;
        const queryResult = await conn.query(query);
        const moduleDefs = await queryResult.getAll();
        for (const moduleDef of moduleDefs) {
            const scope = createScope(moduleDef.m.name, "moduledef", moduleDef.m.file, moduleDef.m.lineNo, -1, moduleDef.m.name, "moduleDefItem", undefined, undefined);
            // scope.description = moduleDef.m.file;
            this.moduleInstances.push(scope);
        }
    }

    private async loadTopModules(conn: any/*kuzu.Connection*/) {
        const query = `MATCH (i:Instance) WHERE i.isTopModule = true RETURN i;`;
        const queryResult = await conn.query(query);
        const topModules = await queryResult.getAll();
        for (const topModule of topModules) {
            const moduleName = await this.getModuleName(conn, topModule.i.fullName) || "unknown";
            const scope = createScope(topModule.i.fullName, "module", topModule.i.file, topModule.i.lineNo, -1, moduleName, "scopeItem", undefined, undefined);
            scope.description = moduleName;
            this.treeData.push(scope);
        }
    }

    private async getModuleName(conn: any/*kuzu.Connection*/, instanceName: string): Promise<string | undefined> {
        const query = `MATCH (m:ModuleDef)-[:instantiate]->(i:Instance {fullName: "${instanceName}"}) RETURN m LIMIT 1;`;
        const queryResult = await conn.query(query);
        const moduleDefs = await queryResult.getAll();
        for (const moduleDef of moduleDefs) {
            return moduleDef.m.name;
        }
        return undefined;
    }

    public async getChildrenExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        if (!element) {
            return this.treeData; // Returns top-level netlist items
        }
        if (element.children.length > 0) {
            return element.children; // Returns cached children
        }
        const [subScopes, variables] = await Promise.all([
            this.getSubScopes(element),
            this.getVariables(element)
        ]);
        element.children = [...subScopes, ...variables];
        return element.children;
    }

    private async getSubScopes(element: NetlistItem): Promise<NetlistItem[]> {
        const conn = new kuzu.Connection(this.db);
        const query = `MATCH (i:Instance {fullName: "${element.fullName}"})-[:subInstance]->(sub_i:Instance) RETURN sub_i;`;
        const queryResult = await conn.query(query);
        const subInstances = await queryResult.getAll();
        const result: NetlistItem[] = [];
        for (const subInstance of subInstances) {
            const moduleName = await this.getModuleName(conn, subInstance.sub_i.fullName) || "unknown";
            const scope = createScope(subInstance.sub_i.fullName, "module", subInstance.sub_i.file, subInstance.sub_i.lineNo, -1, moduleName, "scopeItem", element, undefined);
            scope.description = moduleName;
            result.push(scope);
        }
        return result;
    }

    private async getVariables(element: NetlistItem): Promise<NetlistItem[]> {
        const conn = new kuzu.Connection(this.db);
        const query = `MATCH (i:Instance {fullName: "${element.fullName}"})-[:Var]->(v:Variable) RETURN v;`;
        const queryResult = await conn.query(query);
        const vars = await queryResult.getAll();
        const result: NetlistItem[] = [];
        for (const variable of vars) {
            const v = createVar(variable.v.fullName, variable.v.type, variable.v.width, variable.v.file, variable.v.lineNo, -1, element.moduleName, "varItem", element);
            result.push(v);
        }
        return result;
    }

    public async getDriversAndLoadsExternal(element: NetlistItem): Promise<void> {
        if (element.drivers.length > 0 || element.loads.length > 0) { return; }
        const conn = new kuzu.Connection(this.db);
        const query = `MATCH (v:Variable {fullName: "${element.fullName}"})-[:driver]->(dvr:Assignment) RETURN dvr;`;
        const queryResult = await conn.query(query);
        const drivers = await queryResult.getAll();
        // console.log(drivers);
        for (const driver of drivers) {
            const dvr = createVar(driver.dvr.fullName, "driver", 0, driver.dvr.file, driver.dvr.lineNo, -1, "TODO", "driverItem", element);
            // console.log(driver.dvr);
            element.drivers.push(dvr);
        }

        const query2 = `MATCH (v:Variable {fullName: "${element.fullName}"})-[:load]->(ld:Assignment) RETURN ld;`;
        const queryResult2 = await conn.query(query2);
        const loads = await queryResult2.getAll();
        // console.log(loads);
        for (const load of loads) {
            const ld = createVar(load.ld.fullName, "load", 0, load.ld.file, load.ld.lineNo, -1, "TODO", "loadItem", element);
            // console.log(load.ld);
            element.loads.push(ld);
        }
    }

    public async getModuleInstancesExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        if (!element) {
            return this.moduleInstances;
        }
        if (element.children.length > 0) {
            return element.children; // Returns cached children
        }
        element.children = await this.loadModuleInstances(element);
        return element.children;
    }

    private async loadModuleInstances(element: NetlistItem): Promise<NetlistItem[]> {
        const conn = new kuzu.Connection(this.db);
        const query = `MATCH (m:ModuleDef {name: "${element.fullName}"})-[:instantiate]->(i:Instance) RETURN m,i;`;
        const queryResult = await conn.query(query);
        const instances = await queryResult.getAll();
        const result: NetlistItem[] = [];
        for (const instance of instances) {
            const scope = createVar(instance.i.fullName, "instance", 0, instance.i.file, instance.i.lineNo, -1, instance.m.name, "instanceItem", element);
            // scope.description = instance.m.name;
            result.push(scope);
        }
        return result;
    }

    async getDefinitionFileLocation(element: NetlistItem): Promise<{ filePath: string; lineNumber: number, columnNumber: number }> {
        let filePath = element.sourceFile;
        let lineNumber = element.lineNumber;
        let columnNumber = element.columnNumber;

        if (element.contextValue === 'scopeItem') {
            // Find the module definition in moduleInstances
            const moduleName = element.moduleName;
            const moduleInstances = this.getModuleInstances();
            let index = moduleInstances.findIndex(module => module.fullName === moduleName);
            if (index < 0) {
                console.log('Cannot find module definition for ' + moduleName); // Should not happen
            } else {
                filePath = moduleInstances[index].sourceFile;
                lineNumber = moduleInstances[index].lineNumber;
                columnNumber = moduleInstances[index].columnNumber;
            }
        } else if (element.contextValue === 'instanceItem') {
            // The parent of instanceItem is the moduleDef, so use its sourceFile and lineNumber
            filePath = element.parent!.sourceFile;
            lineNumber = element.parent!.lineNumber;
            columnNumber = element.parent!.columnNumber;
        }

        return { filePath, lineNumber, columnNumber };
    }

    public async unload(): Promise<void> {
        this.unloadTreeData();
        if (this.db) {
            await this.db.close();
            this.db = undefined;
        }
    }
}

// #region UhdmDesignItem
class UhdmDesignItem extends DesignItem {
    private designId = -1; // Used to identify the design in UHDM addon
    public uhdmAddon?: any | undefined; // TODO(heyfey): make it private

    public async load(): Promise<boolean> {
        try {
            this.uhdmAddon = require('../build/Release/uhdm_addon.node');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load UHDM addon: ' + error);
            return false;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Reading design database: " + this.resourceUri.fsPath,
                cancellable: false
            }, async () => {
                this.designId = await this.uhdmAddon.loadDesign(this.resourceUri.fsPath);
                if (showModulesViewEnabled()) {
                    // Consider remove "await" for large designs, but:
                    //   1. Need to make sure loadModuleDefs is finished before selectInstance called
                    //   2. Need to refresh moduleInstancesTreeProvider after loadModuleDefs is finished
                    await this.loadModuleDefs();
                }
                await this.loadTopModules();
            });
            return true;
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load design database: ' + error);
            return false;
        }
    }

    private async loadTopModules() {
        const topModules = await this.uhdmAddon.getTopModules(this.designId);
        for (const topModule of topModules) {
            const defName = topModule.defName.replace("work@", ""); // remove prefix for UHDM
            const scope = createScope(topModule.name, "module", topModule.file, topModule.line, topModule.column, defName, "scopeItem", undefined, topModule.handle);
            scope.description = defName;
            this.treeData.push(scope);
        }
    }

    public async getChildrenExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        if (!element) {
            return this.treeData; // Returns top-level netlist items
        }
        if (element.children.length > 0) {
            return element.children; // Returns cached children
        }
        const [subScopes, variables] = await Promise.all([
            this.getSubScopes(element),
            this.getVariables(element)
        ]);
        element.children = [...subScopes, ...variables];
        return element.children;
    }

    private async getSubScopes(element: NetlistItem): Promise<NetlistItem[]> {
        const subScopes = await this.uhdmAddon.getSubScopes(element.handle);
        const result: NetlistItem[] = [];
        for (const subScope of subScopes) {
            const defName = subScope.defName.replace("work@", ""); // remove prefix for UHDM
            const scope = createScope(subScope.name, subScope.type, subScope.file, subScope.line, subScope.column, defName, "scopeItem", element, subScope.handle);
            scope.description = defName;
            result.push(scope);
        }
        return result;
    }

    private async getVariables(element: NetlistItem): Promise<NetlistItem[]> {
        const vars = await this.uhdmAddon.getVars(element.handle);
        const result: NetlistItem[] = [];
        for (const variable of vars) {
            const v = createVar(variable.name, variable.type, variable.width, variable.file, variable.line, variable.column, element.moduleName, "varItem", element);
            if (variable.constValue !== undefined) {
                v.description = `= ${variable.constValue}`;
            }
            result.push(v);
        }
        return result;
    }

    public async getDriversAndLoadsExternal(element: NetlistItem): Promise<void> {
        return;
    }

    private async loadModuleDefs() {
        const moduleDefs = await this.uhdmAddon.getModuleDefs(this.designId);
        for (const moduleDef of moduleDefs) {
            // console.log(`Loaded module definition: ${moduleDef.defName} (${moduleDef.file}:${moduleDef.line})`);
            const defName = moduleDef.defName.replace("work@", ""); // remove prefix for UHDM
            const scope = createScope(defName, moduleDef.type, moduleDef.file, moduleDef.line, moduleDef.column, defName, "moduleDefItem", undefined, moduleDef.handle);
            scope.description = `${moduleDef.size}`;
            this.moduleInstances.push(scope);
        }
    }

    public async getModuleInstancesExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        if (!element) {
            return this.moduleInstances;
        }
        if (element.children.length > 0) {
            return element.children; // Returns cached children
        }
        element.children = await this.loadModuleInstances(element);
        return element.children;
    }

    private async loadModuleInstances(element: NetlistItem): Promise<NetlistItem[]> {
        const moduleName = "work@" + element.moduleName; // add prefix for UHDM
        const instances = await this.uhdmAddon.getModuleInstances(this.designId, moduleName);
        const result: NetlistItem[] = [];
        for (const instance of instances) {
            const scope = createScope(instance.fullName, instance.type, instance.file, instance.line, instance.column, instance.name, "instanceItem", element, undefined);
            // scope.description = instance.name;
            result.push(scope);
        }
        return result;
    }

    // Native capped fuzzy search over the addon's resident instance index (built once via
    // EnsureDesignIndex). Match + cap happen in C++ — only up to maxResults instances cross into JS.
    public async searchInstances(query: string, maxResults: number): Promise<InstanceSearchHits> {
        const hits = await this.uhdmAddon.searchInstances(this.designId, query, maxResults);
        const results: InstanceSearchResult[] = (hits.results || []).map((inst: any) => ({
            // Strip the UHDM "work@" library prefix here so the path is clean for both display and
            // navigation (the hierarchy tree is always clean — see NetlistItem ctor / findTreeItem).
            instPath: (inst.fullName || '').replace(/^work@/, ''),
            declName: (inst.declName || '').replace(/^work@/, ''),
            file: inst.file,
            line: inst.line,
            column: inst.column,
        }));
        return { total: hits.total ?? results.length, results };
    }

    async getDefinitionFileLocation(element: NetlistItem): Promise<{ filePath: string; lineNumber: number, columnNumber: number }> {
        let filePath = element.sourceFile;
        let lineNumber = element.lineNumber;
        let columnNumber = element.columnNumber;

        if (element.contextValue === 'scopeItem') {
            // Only need to get moduleDef for non-top-module, as sourceFile and lineNumber for top-module is already correct
            if (element.parent) {
                const moduleDef = await this.uhdmAddon.getModuleDef(element.handle);
                if (!moduleDef.file) {
                    // Might happen when vpiDefFile not found because of UHDM bug
                    vscode.window.showWarningMessage('UHDM: definition not found for ' + element.moduleName + '. Please try to select a variable under it as workaround.');
                }
                filePath = moduleDef.file;
                lineNumber = moduleDef.line;
                columnNumber = moduleDef.column;
            }
        } else if (element.contextValue === 'instanceItem') {
            // The parent of instanceItem is the moduleDefItem, so use its sourceFile and lineNumber
            filePath = element.parent!.sourceFile;
            lineNumber = element.parent!.lineNumber;
            columnNumber = element.parent!.columnNumber;
        }

        return { filePath, lineNumber, columnNumber };
    }

    public async unload(): Promise<void> {
        this.unloadTreeData();
        await this.uhdmAddon.unloadDesign(this.designId);
    }
}

function parseSlangType(typeDecl: string): { direction: string | null; type: string | null; bitRange: string | null } {
    // Regex breakdown:
    // ^\s*                     -> optional leading whitespace
    // (input|output|inout)?    -> optional direction
    // \s*                      -> optional spaces
    // (\w+)                    -> type (logic, reg, wire, etc.)
    // \s*                      -> optional spaces
    // (\[\s*\d+\s*:\s*\d+\s*\])? -> optional bitRange [msb:lsb], with flexible spaces
    // \s*$                     -> trailing whitespace
    const re = /^\s*(input|output|inout)?\s*(\w+)\s*(\[\s*\d+\s*:\s*\d+\s*\])?\s*$/i;
    const match = typeDecl.match(re);

    if (!match) {
        return { direction: null, type: null, bitRange: null };
    }

    const direction = match[1] ? match[1].toLowerCase() : null;
    const type = match[2].toLowerCase();
    const bitRangeRaw = match[3] || null;

    // Normalize bitRange: remove all whitespace inside [ ]
    const bitRange = bitRangeRaw ? bitRangeRaw.replace(/\s+/g, '') : null;

    return { direction, type, bitRange };
}

// #region SlangDesignItem
class SlangDesignItem extends DesignItem {
    // Top $unit, has top level(s) + packages
    private unit?: slang.Instance[] | undefined = undefined;

    // This is called in setActiveDesign, that means we recompile every time user switch designs.
    // This should be reviewed, search for "slangfixme" for related code.
    public async load(): Promise<boolean> {
        // slang-server resolves relative .f paths against its own CWD (which we
        // don't control), so rewrite the build file with absolute paths first.
        const buildFile = await absolutizeFlist(this.resourceUri.fsPath);
        await slang.setBuildFile(buildFile);
        this.unit = await slang.getUnit();
        // console.log("Loaded SlangDesignItem: " + this.resourceUri.fsPath);
        // console.log(this.unit);

        // Though we recompile every time, we reuse the loaded treeData and moduleInstances
        // from the first time. Use "reloadDesign" if the design file is changed on disk.
        // slangfixme
        if (this.treeData.length == 0) {
            await this.loadTopModules();
        }
        if (this.moduleInstances.length == 0) {
            await this.loadModuleDefs();
        }

        // console.log(this.treeData);
        return true;
    }

    private async loadTopModules() {
        for (const top of this.unit!) {
            if (top.kind === slang.SlangKind.Instance) { // not handle packages yet
                const uri = top.declLoc.uri.toString();
                const file = vscode.Uri.parse(uri).fsPath;
                const line = top.declLoc.range.start.line + 1;
                const column = top.declLoc.range.start.character + 1;

                const scope = createScope(top.instName, "module", file, line, column, top.declName, "scopeItem", undefined, undefined);
                scope.description = top.declName;
                this.treeData.push(scope);
            }
        }
    }

    private async loadModuleDefs() {
        const modules = await slang.getScopesByModule();
        for (const module of modules) {
            const uri = module.declLoc.uri.toString();
            const file = vscode.Uri.parse(uri).fsPath;
            const line = module.declLoc.range.start.line + 1;
            const column = module.declLoc.range.start.character + 1;
            const scope = createScope(module.declName, "module", file, line, column, module.declName, "moduleDefItem", undefined, undefined);
            scope.description = `${module.instCount}`;
            if (module.inst) {
                this.addInstanceChild(scope, module.inst);
            }
            this.moduleInstances.push(scope);
        }
    }

    public async getModuleInstancesExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        if (!element) {
            return this.moduleInstances;
        }
        if (element.children.length > 0) {
            return element.children; // Returns cached children
        }
        const insts = await slang.getInstancesOfModule(element.name);
        for (const inst of insts) {
            this.addInstanceChild(element, inst);
        }
        return element.children;
    }

    // Slang has no server-side instance-search command (unlike its workspace/symbol), so we enumerate
    // every instance once (each module's instances via getInstancesOfModule — mirrors slang-server's
    // own fuzzyFindInstance) and filter client-side. Cached until reload (unloadTreeData clears it).
    private async allInstances(): Promise<InstanceSearchResult[]> {
        if (this.instanceSearchCache) { return this.instanceSearchCache; }
        if (this.moduleInstances.length === 0) { await this.loadModuleDefs(); }
        const out: InstanceSearchResult[] = [];
        for (const mod of this.moduleInstances) {
            const insts = await slang.getInstancesOfModule(mod.name);
            for (const inst of insts) {
                const loc = inst.instLoc;
                out.push({
                    instPath: inst.instPath,
                    declName: mod.name,
                    file: vscode.Uri.parse(loc.uri.toString()).fsPath,
                    line: loc.range.start.line + 1,
                    column: loc.range.start.character + 1,
                });
            }
        }
        this.instanceSearchCache = out;
        return out;
    }

    public async searchInstances(query: string, maxResults: number): Promise<InstanceSearchHits> {
        return filterAndCapInstances(await this.allInstances(), query, maxResults);
    }

    private addInstanceChild(element: NetlistItem, inst: any/*slang.Item*/) {
        let uri = inst.instLoc.uri.toString();
        let file = vscode.Uri.parse(uri).fsPath;
        let line = inst.instLoc.range.start.line + 1;
        let column = inst.instLoc.range.start.character + 1;
        const scope = createScope(inst.instPath, "instance", file, line, column, inst.instPath, "instanceItem", element, undefined);
        element.children.push(scope);
    }

    public async getChildrenExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        if (!element) {
            return this.treeData;
        }
        if (element.children.length > 0) {
            return element.children;
        }

        let children: any[] = []; // slang.Item[]
        children = await slang.getScope(element.fullName);

        const [subScopes, variables] = this.collectChildren(element, children);
        element.children = [...subScopes, ...variables];
        return element.children;
    }

    // Collect children into subScopes and variables recursively
    private collectChildren(element: NetlistItem, children: any[]/*slang.Item[]*/): [NetlistItem[], NetlistItem[]] {
        const subScopes: NetlistItem[] = [];
        const variables: NetlistItem[] = [];
        for (const child of children) {
            const uri = child.instLoc.uri.toString();
            const file = vscode.Uri.parse(uri).fsPath;
            const line = child.instLoc.range.start.line + 1;
            const column = child.instLoc.range.start.character + 1;
            let scope;
            let fullName = element.fullName + '.' + child.instName;
            switch (child.kind) {
                case slang.SlangKind.Instance:
                    // Might want to save decLoc also? So don't need to search declLoc in moduleInstances.
                    // uri = child.declLoc.uri.toString();
                    // file = vscode.Uri.parse(uri).fsPath;
                    // line = child.declLoc.range.start.line + 1;
                    // column = child.declLoc.range.start.character + 1;
                    if (element.type === 'instancearray') { fullName = element.fullName + child.instName; }
                    scope = createScope(fullName, "module", file, line, column, child.declName, "scopeItem", element, undefined);
                    if (child.declName && child.declName !== "") {
                        scope.description = child.declName;
                    }
                    subScopes.push(scope);
                    break
                case slang.SlangKind.InstanceArray:
                    scope = createScope(fullName, "instancearray", file, line, column, element.moduleName, "scopeItem", element, undefined);
                    if (child.declName && child.declName !== "") {
                        scope.description = child.declName;
                    }
                    const [subSubScopes, subVariables] = this.collectChildren(scope, child.children);
                    scope.children = [...subSubScopes, ...subVariables];
                    subScopes.push(scope);
                    break
                case slang.SlangKind.Param:
                case slang.SlangKind.Port:
                case slang.SlangKind.Logic:
                    const parsed = parseSlangType(child.type);
                    // console.log(`Name: ${child.instName}, Input: "${child.type}" -> Direction: ${parsed.direction}, Type: ${parsed.type}, bitRange: ${parsed.bitRange}`);
                    let type = parsed.type ? parsed.type : "unknown";
                    if (child.kind === slang.SlangKind.Param) { type = "parameter"; }
                    if (child.kind === slang.SlangKind.Port) { type = "port"; }
                    const v = createVar(fullName, type, 0, file, line, column, element.moduleName, "varItem", element);
                    v.description = child.type;
                    if (child.kind === slang.SlangKind.Param) {
                        v.description += ` = ${child.value}`;
                    }
                    variables.push(v);
                    break
                case slang.SlangKind.Scope:
                    if (element.type === 'scopearray') { fullName = element.fullName + child.instName; }
                    scope = createScope(fullName, "scope", file, line, column, element.moduleName, "scopeItem", element, undefined);
                    const [subSubScopes2, subVariables2] = this.collectChildren(scope, child.children);
                    scope.children = [...subSubScopes2, ...subVariables2];
                    subScopes.push(scope);
                    break
                case slang.SlangKind.ScopeArray:
                    scope = createScope(fullName, "scopearray", file, line, column, element.moduleName, "scopeItem", element, undefined);
                    scope.description = child.declName;
                    const [subScopes3, subVariables3] = this.collectChildren(scope, child.children);
                    scope.children = [...subScopes3, ...subVariables3];
                    subScopes.push(scope);
                    break
                default:
                    vscode.window.showErrorMessage('Unknown item kind: ' + child.kind);
            }
        }
        return [subScopes, variables];
    }

    public async getDriversAndLoadsExternal(element: NetlistItem): Promise<void> {
        return;
    }

    // The implementation is same as KuzuDesignItem, that find definition from moduleInstances for scopeItem. However, we
    // should consider to store definition location in scopeItem when loading treeData to avoid searching every time.
    async getDefinitionFileLocation(element: NetlistItem): Promise<{ filePath: string; lineNumber: number, columnNumber: number }> {
        let filePath = element.sourceFile;
        let lineNumber = element.lineNumber;
        let columnNumber = element.columnNumber;

        if (element.contextValue === 'scopeItem') {
            // Find the module definition in moduleInstances
            const moduleName = element.moduleName;
            const moduleInstances = this.getModuleInstances();
            let index = moduleInstances.findIndex(module => module.fullName === moduleName);
            if (index < 0) {
                console.log('Cannot find module definition for ' + moduleName); // Should not happen
            } else {
                filePath = moduleInstances[index].sourceFile;
                lineNumber = moduleInstances[index].lineNumber;
                columnNumber = moduleInstances[index].columnNumber;
            }
        } else if (element.contextValue === 'instanceItem') {
            // The parent of instanceItem is the moduleDef, so use its sourceFile and lineNumber
            filePath = element.parent!.sourceFile;
            lineNumber = element.parent!.lineNumber;
            columnNumber = element.parent!.columnNumber;
        }

        return { filePath, lineNumber, columnNumber };
    }

    public async unload(): Promise<void> {
        this.unloadTreeData();
        this.unit = undefined;
        await slang.setBuildFile('');
    }
}

// #region FDesignItem
class FDesignItem extends DesignItem {
    private delegateDesign!: DesignItem;
    private generatedUhdmUri?: vscode.Uri; // For generated UHDM file from Surelog

    private static surelogOutputChannel: vscode.OutputChannel | undefined;

    public async load(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('sv-pathfinder');
        const compiler = config.get<string>('compiler');
        if (compiler === 'slang-server') {
            return await this.loadSlang();
        }
        return await this.loadSurelog();
    }

    private async loadSlang(): Promise<boolean> {
        this.delegateDesign = new SlangDesignItem(this.resourceUri.fsPath, this.isExample);
        // Defer loading to setActiveDesign, that means we recompile every time user switch designs
        // slangfixme
        // await this.delegateDesign.load();
        this.treeData = this.delegateDesign.getTreeData();
        return true;
    }

    private async runSurelog(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('sv-pathfinder');
        let surelogPath = config.get<string>('surelogPath') || 'surelog';

        // Verify Surelog exists
        try {
            await new Promise<void>((resolve, reject) => {
                const verifyProc = cp.spawn(surelogPath, ['--version']);
                verifyProc.on('error', reject);
                verifyProc.on('close', (code) => {
                    if (code === 0) { resolve(); }
                    else { reject(new Error(`Surelog verification failed with code ${code}`)); }
                });
            });
        } catch (error) {
            vscode.window.showErrorMessage('Surelog not found or failed to execute. Please install Surelog or set "sv-pathfinder.surelogPath" in settings.');
            return false;
        }

        const uuid = crypto.randomUUID();
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `sv-pathfinder-${uuid}-`));

        // Create an output channel for Surelog logs
        if (!FDesignItem.surelogOutputChannel) {
            FDesignItem.surelogOutputChannel = vscode.window.createOutputChannel('Surelog Output');
        }

        // Prepare Surelog arguments
        const args = [
            '-f', this.resourceUri.fsPath,
            '-odir', tempDir,
            '-parse',
            '-sverilog',
            '-d', 'uhdm',
            '-elabuhdm', // Optional
        ];

        // Spawn Surelog process
        try {
            await new Promise<void>((resolve, reject) => {
                const flistDir = path.dirname(this.resourceUri.fsPath);
                const proc = cp.spawn(surelogPath, args, {
                    cwd: flistDir,
                    shell: true // For PATH resolution if needed
                });

                proc.stdout.on('data', (data) => FDesignItem.surelogOutputChannel!.append(data.toString()));
                proc.stderr.on('data', (data) => FDesignItem.surelogOutputChannel!.append(data.toString()));

                proc.on('error', reject);
                proc.on('close', (code) => {
                    if (code === 0) { resolve(); }
                    else { reject(new Error(`Surelog exited with code ${code}. Check "Surelog Output" channel for details.`)); }
                });
            });

            // Verify generated UHDM file exists
            const uhdmPath = path.join(tempDir, 'slpp_all', 'surelog.uhdm');
            await fs.access(uhdmPath);
            // console.log(`UHDM file generated at: ${uhdmPath}`);

            this.generatedUhdmUri = vscode.Uri.file(uhdmPath);
            return true;

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to generate UHDM: ${error instanceof Error ? error.message : String(error)}`);
            FDesignItem.surelogOutputChannel.show(true);
            // Optional: Clean up tempDir on failure
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch { }
            return false;
        }
    }

    private async loadSurelog(): Promise<boolean> {
        // Run Surelog to generate UHDM
        const success = await this.runSurelog();
        if (!success) {
            return false;
        }
        try {
            // Create and load the delegate design
            this.delegateDesign = new UhdmDesignItem(this.generatedUhdmUri!.fsPath, this.isExample);
            const success = await this.delegateDesign.load();
            if (success) {
                // Load the top modules from the generated design
                this.treeData = this.delegateDesign.getTreeData();
                return true;
            } else {
                return false;
            }
        } catch (error) {
            // Optional: Clean up tempDir on failure
            const tempDir = path.dirname(path.dirname(this.generatedUhdmUri!.fsPath)); // Assuming /tempDir/slpp_all/surelog.uhdm
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch { }
            return false;
        }
    }

    // tree data and module instances are from delegate design
    public getTreeData(): NetlistItem[] { return this.delegateDesign.getTreeData(); }
    public getModuleInstances(): NetlistItem[] { return this.delegateDesign.getModuleInstances(); }
    public get DelegateDesign(): DesignItem { return this.delegateDesign; }

    public async getChildrenExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        if (!element) {
            return this.treeData; // Returns top-level netlist items
        }
        await this.delegateDesign.getChildrenExternal(element);
        return element.children;
    }

    public async getDriversAndLoadsExternal(element: NetlistItem): Promise<void> {
        return;
    }

    public async searchInstances(query: string, maxResults: number): Promise<InstanceSearchHits> {
        return this.delegateDesign.searchInstances(query, maxResults);
    }
    public async getModuleInstancesExternal(element: NetlistItem | undefined): Promise<NetlistItem[]> {
        return this.delegateDesign.getModuleInstancesExternal(element);
    }

    async getDefinitionFileLocation(element: NetlistItem): Promise<{ filePath: string; lineNumber: number, columnNumber: number }> {
        return this.delegateDesign.getDefinitionFileLocation(element);
    }

    public async unload(): Promise<void> {
        this.unloadTreeData();
        await this.delegateDesign.unload();
        // Clean up temp files
        if (this.generatedUhdmUri) {
            const tempDir = path.dirname(path.dirname(this.generatedUhdmUri.fsPath)); // Assuming /tempDir/slpp_all/surelog.uhdm
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch { }
            this.generatedUhdmUri = undefined; // Clear the URI after cleanup
        }
    }
}

// #region OpenedDesignsTreeProvider
export class OpenedDesignsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private designList: DesignItem[] = [];
    private activeDesign: DesignItem | undefined = undefined;

    constructor(
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly moduleInstancesTreeProvider: ModuleInstancesTreeProvider,
    ) {
    }

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _onDidChangeActiveWaveformForActiveDesign: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    public readonly onDidChangeActiveWaveformForActiveDesign: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeActiveWaveformForActiveDesign.event;

    public async openDesign(): Promise<boolean> {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            filters: {
                'Designs': ['uhdm', 'f', 'elab.kz', 'simv.daidir'],
            }
        };

        const uris = await vscode.window.showOpenDialog(options);
        if (!uris || uris.length === 0) { return false; }
        const selectedFile = uris[0]; // Get the first (and only) selected file
        this.addDesign(selectedFile.fsPath);
        return true;
    }

    public async openExampleDesign(): Promise<boolean> {
        // add design "../examples/test/surelog.uhdm"
        const examplePath = path.join(__dirname, '..', 'examples', 'test', 'surelog.uhdm');
        this.addDesign(examplePath, true/*isExample*/);
        return true;
    }

    private async addDesign(designPath: string, isExample: boolean = false) {
        let index = this.designList.findIndex(design => design.resourceUri.fsPath === designPath);
        if (index < 0) {
            const fileType = designPath.split('.').pop()?.toLocaleLowerCase() || '';
            let design: DesignItem;
            if (fileType === 'uhdm') {
                design = new UhdmDesignItem(designPath, isExample);
            } else if (fileType === 'f') {
                design = new FDesignItem(designPath, false/*isExample*/);
            } else {
                design = new KuzuDesignItem(designPath, false/*isExample*/);
            }
            const success = await design.load();
            if (success) {
                this.designList.push(design);
                // If it's the first design, select it
                if (this.designList.length === 1) {
                    await this.selectDesign(design);
                }
            }
        } else {
            // this.designList[index] = database;
            // reveal the design
        }
        this.refresh();
        // return this.designList.length;
    }

    public async closeDesign(element: DesignItem) {
        await element.unload();
        if (this.activeDesign === element) {
            this.activeDesign = undefined;
        }
        // Remove the design from the list
        const index = this.designList.indexOf(element);
        if (index >= 0) {
            this.designList.splice(index, 1);
        }
        this.refresh();
        if (this.hierarchyTreeProvider.getActiveDesign() === element) {
            await this.hierarchyTreeProvider.setActiveDesign(undefined);
            await this.moduleInstancesTreeProvider.setActiveDesign(undefined);
        }
    }

    public async reloadDesign(element: DesignItem) {
        await element.reload();

        // slangfixme
        if (this.activeDesign === element) {
            if (element instanceof FDesignItem && element.DelegateDesign instanceof SlangDesignItem) {
                // Force re-select to reload Slang design. This is because we defer loading
                // to setActiveDesign, so need to re-trigger it here.
                this.activeDesign = undefined;
                await this.hierarchyTreeProvider.setActiveDesign(undefined);
                await this.selectDesign(element);
            }
        }

        this.hierarchyTreeProvider.refreshDesign(element);
        this.moduleInstancesTreeProvider.refreshDesign(element);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: vscode.TreeItem | undefined): vscode.ProviderResult<vscode.TreeItem[]> {
        if (!element) {
            return Promise.resolve(this.designList);
        }
        if (element instanceof DesignItem) {
            return Promise.resolve(element.getWaveforms());
        }
        return Promise.resolve([]);
    }

    getParent(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
        if (element instanceof WaveformItem) {
            return element.design;
        }
        return null;
    }

    resolveTreeItem?(item: vscode.TreeItem, element: vscode.TreeItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    async selectDesign(element: DesignItem) {
        if (!element) { return; }
        if (this.activeDesign === element) { return; }
        if (this.activeDesign) {
            this.activeDesign.iconPath = new vscode.ThemeIcon('file-directory');
        }
        this.activeDesign = element;
        this.activeDesign.iconPath = new vscode.ThemeIcon('folder-active');

        await this.hierarchyTreeProvider.setActiveDesign(element);
        await this.moduleInstancesTreeProvider.setActiveDesign(element);
        if (element instanceof UhdmDesignItem || element instanceof FDesignItem) {
            // Hide the not used views for UHDM designs
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.driversViewVisible', false);
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.loadsViewVisible', false);
        } else {
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.driversViewVisible', true);
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.loadsViewVisible', true);
        }
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public async openWaveformIfNotPresent(element: DesignItem) {
        let activeWaveform = element.getActiveWaveform();
        if (!activeWaveform) {
            await this.openWaveform(element);
        }
    }

    public async openWaveform(element: DesignItem): Promise<WaveformItem | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Waveform files': ['vcd', 'fst', 'ghw', 'fsdb'],
            }
        };

        const uris = await vscode.window.showOpenDialog(options);
        if (!uris || uris.length === 0) { return undefined; }
        const selectedFile = uris[0]; // Get the first (and only) selected file
        try {
            await vscode.commands.executeCommand("vaporview.openFile", { uri: selectedFile });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to open waveform: ' + error);
            return undefined;
        }
        const wavefrom = element.addWaveform(selectedFile);
        element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.refresh();
        // addWaveform makes the first waveform active on the DesignItem but does NOT fire the
        // active-waveform change event — so a schematic (or editor annotation) that was already open
        // wouldn't pick up the newly opened waveform. Fire it so they push values immediately.
        if (wavefrom) { this.setActiveWaveformForDesign(element, wavefrom); }
        return wavefrom;
    }

    public async revealWaveform(element: WaveformItem) {
        try {
            await vscode.commands.executeCommand("vaporview.openFile", { uri: element.resourceUri });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to open waveform: ' + error);
            return;
        }
    }

    private setActiveWaveformForDesign(design: DesignItem, waveform: WaveformItem | undefined) {
        design.setActiveWaveform(waveform);
        // Only care about active waveform changes for the active design
        if (design === this.hierarchyTreeProvider.getActiveDesign()) {
            this._onDidChangeActiveWaveformForActiveDesign.fire(waveform);
        }
    }

    public async closeWaveform(element: WaveformItem) {
        const design = this.getParent(element)!;
        if (design instanceof DesignItem) { // always true
            const index = design.getWaveforms().indexOf(element);
            if (index >= 0) {
                design.getWaveforms().splice(index, 1);
                this.refresh();
            }

            if (element === design.getActiveWaveform()) {
                this.setActiveWaveformForDesign(design, undefined);
            }
        }
    }

    public handleCheckWaveformItem(element: vscode.TreeItem) {
        const design = this.getParent(element)!;
        if (design instanceof DesignItem) { // always true
            for (const waveform of design.getWaveforms()) {
                if (waveform instanceof WaveformItem) { // always true
                    if (waveform !== element) {
                        waveform.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
                    } else {
                        waveform.checkboxState = vscode.TreeItemCheckboxState.Checked;
                        this.setActiveWaveformForDesign(design, waveform);
                    }
                }
            }
            this.refresh();
        }
    }

    public handleUncheckWaveformItem(element: vscode.TreeItem) {
        const design = this.getParent(element)!;
        if (design instanceof DesignItem) { // always true
            this.setActiveWaveformForDesign(design, undefined);
        }
    }
}

export function replaceFilePathIfNeeded(filePath: string, isExample: boolean = false) {
    // dirty fix for absolute path in the example uhdm
    if (isExample) {
        const from = "/home/heyfey/git-repos/sv-pathfinder";
        const to = path.join(__dirname, '..');
        return filePath.replace(from, to);
    }

    // get from and to from configuration
    const from = vscode.workspace.getConfiguration('sv-pathfinder').get('remotePathPrefix', '');
    const to = vscode.workspace.getConfiguration('sv-pathfinder').get('localPathPrefix', '');
    if (!from || !to || from === to) {
        return filePath; // No replacement needed
    }
    return filePath.replace(from, to);
}

// Find the view column of an already-open tab for `uri`, scanning all tab groups (covers background
// tabs, not just each group's visible editor). Returns undefined if the file isn't open anywhere.
function findOpenViewColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
    const groups = vscode.window.tabGroups.all.map((g) => ({
        column: g.viewColumn,
        paths: g.tabs
            .map((t) => (t.input instanceof vscode.TabInputText ? t.input.uri.fsPath : undefined))
            .filter((p): p is string => p !== undefined),
    }));
    return findColumnForPath(groups, uri.fsPath);
}

export async function showTextDocumentLocation(filePath: string, lineNumber: number, columnNumber: number, isExample: boolean = false) {
    filePath = replaceFilePathIfNeeded(filePath, isExample);
    const uri = vscode.Uri.file(filePath);
    columnNumber = columnNumber > 0 ? columnNumber - 1 : 0; // Convert to 0-based index

    // If the file is already open in some editor group (common with split layouts), reuse that group
    // instead of opening a duplicate in the active group. Otherwise open as a preview in the active
    // group (the prior behavior).
    const viewColumn = findOpenViewColumn(uri);
    const options: vscode.TextDocumentShowOptions = viewColumn !== undefined
        ? { viewColumn, preview: false }
        : { preview: true };

    const range = new vscode.Range(lineNumber - 1, columnNumber, lineNumber - 1, columnNumber);
    const editor = await vscode.window.showTextDocument(uri, options);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(range.start, range.start);
}

// #region HierarchyTreeProvider
export class HierarchyTreeProvider implements vscode.TreeDataProvider<NetlistItem> {
    private activeDesign: DesignItem | undefined = undefined;
    private treeData: NetlistItem[] = [];

    private activeScopeStatusBarItem: vscode.StatusBarItem;
    // The hierarchy TreeView is created AFTER this provider (it needs the provider), so it's injected
    // later via setHierarchyTreeView. Used only to reveal the active scope WHEN the view is open.
    private hierarchyTreeView: vscode.TreeView<NetlistItem> | undefined;

    constructor(
        public readonly driversView: vscode.TreeView<vscode.TreeItem>,
        public readonly driversTreeProvider: DriversLoadsTreeProvider,
        public readonly loadsView: vscode.TreeView<vscode.TreeItem>,
        public readonly loadsTreeProvider: DriversLoadsTreeProvider,
    ) {
        this.activeScopeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
    }

    public setHierarchyTreeView(view: vscode.TreeView<NetlistItem>) {
        this.hierarchyTreeView = view;
    }

    // Reveal+select an element in the hierarchy tree ONLY if that view is currently open. Revealing
    // when the view is closed would force it open (intrusive when navigating from the schematic);
    // active-scope changes and back/forward must still work in that case — they just don't reveal.
    public revealIfVisible(element: NetlistItem | undefined) {
        if (element && this.hierarchyTreeView?.visible) {
            this.hierarchyTreeView.reveal(element, { select: true, focus: false, expand: 1 });
        }
    }

    // Set the active scope from an external navigator (the schematic) so the editor value annotation
    // follows: set it active (fires onDidChangeActiveInstance), record history so back/forward
    // includes the jump, and reveal in the tree only if it's open.
    public async activateScope(element: NetlistItem) {
        const changed = await this.setActiveInstance(element);
        if (changed) { await this.setContextForGoBackOrForward(element, 'gotoDefinition', false); }
        this.revealIfVisible(element);
    }

    // "Go to this instance" navigation: resolve a Modules-view instanceItem to its hierarchy node,
    // set it active, record history, and select it in the Hierarchy view — but only if that view is
    // already open. Never force the sidebar open or steal focus (uses revealIfVisible, not reveal).
    public async revealScopeInHierarchy(element: NetlistItem) {
        let scope = element;
        if (scope.contextValue === 'instanceItem' && this.activeDesign) {
            scope = await this.activeDesign.findTreeItem(scope.fullName) ?? scope;
        }
        const changed = await this.setActiveInstance(scope);
        if (changed) { await this.setContextForGoBackOrForward(scope, 'gotoInstantiation', false); }
        if (scope.contextValue === 'scopeItem') { this.revealIfVisible(scope); }
    }

    // Global "find instance in design": a QuickPick that queries the active design's backend per
    // keystroke (slang JS-filters its cached enumeration; UHDM matches + caps natively), capped so the
    // full list never floods the UI. On accept, reveal + activate the chosen instance. The tree stays
    // lazy — only the picked instance is materialized.
    public searchDesign() {
        const design = this.activeDesign;
        if (!design) {
            vscode.window.showInformationMessage('Open a design first to search it.');
            return;
        }
        const CAP = 200;
        const qp = vscode.window.createQuickPick<InstanceQuickPickItem>();
        qp.placeholder = 'Find instance by hierarchy path…';
        qp.matchOnDetail = true; // VS Code fuzzy-highlights the full path among our matches

        // Async hygiene: debounce keystrokes, keep at most one backend query in flight, and run only
        // the latest pending query when it returns (coalesce) so fast typing can't pile up requests.
        let inFlight = false;
        let pending: string | undefined;
        let timer: NodeJS.Timeout | undefined;
        const run = async (value: string) => {
            if (inFlight) { pending = value; return; }
            if (!value) { qp.items = []; qp.title = undefined; return; }
            inFlight = true; qp.busy = true;
            try {
                const hits = await design.searchInstances(value, CAP);
                qp.items = toInstanceQuickPickItems(hits.results);
                qp.title = hits.total > hits.results.length
                    ? `Showing ${hits.results.length} of ${hits.total} — refine to narrow`
                    : `${hits.total} ${hits.total === 1 ? 'instance' : 'instances'}`;
            } catch (e: any) {
                qp.items = []; qp.title = `Search failed: ${e?.message ?? e}`;
            } finally {
                inFlight = false; qp.busy = false;
                const next = pending; pending = undefined;
                if (next !== undefined && next !== value) { run(next); }
            }
        };

        qp.onDidChangeValue((v) => {
            if (timer) { clearTimeout(timer); }
            timer = setTimeout(() => run(v), 120);
        });
        qp.onDidAccept(async () => {
            const picked = qp.selectedItems[0];
            qp.hide();
            if (!picked) { return; }
            const item = await design.findTreeItem(picked.result.instPath);
            if (!item) {
                vscode.window.showWarningMessage('Instance not found in hierarchy: ' + picked.result.instPath);
                return;
            }
            const changed = await this.setActiveInstance(item);
            if (changed) { await this.setContextForGoBackOrForward(item, 'gotoInstantiation', false); }
            // Deliberate action → force the Hierarchy view open and reveal (not the conditional reveal).
            if (this.hierarchyTreeView) {
                await this.hierarchyTreeView.reveal(item, { select: true, focus: true, expand: 1 });
            }
        });
        qp.onDidHide(() => { if (timer) { clearTimeout(timer); } qp.dispose(); });
        qp.show();
    }

    private _onDidChangeTreeData: vscode.EventEmitter<NetlistItem | undefined | null | void> = new vscode.EventEmitter<NetlistItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<NetlistItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _onDidChangeActiveInstance: vscode.EventEmitter<NetlistItem | undefined | null | void> = new vscode.EventEmitter<NetlistItem | undefined | null | void>();
    public readonly onDidChangeActiveInstance: vscode.Event<NetlistItem | undefined | null | void> = this._onDidChangeActiveInstance.event;

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public refreshDesign(design: DesignItem) {
        if (this.activeDesign !== design) { return; }
        this.treeData = design?.getTreeData() ?? [];
        this.refresh();

        // Clear the drivers and loads tree data
        this.driversTreeProvider.setTreeData([]);
        this.loadsTreeProvider.setTreeData([]);
        this.driversTreeProvider.refresh();
        this.loadsTreeProvider.refresh();
    }

    public async setActiveDesign(design: DesignItem | undefined) {
        if (this.activeDesign === design) { return; }

        // slangfixme
        if (design instanceof FDesignItem && design.DelegateDesign instanceof SlangDesignItem) {
            // For slang, we recompile the whole design when switching designs
            await design.DelegateDesign.load();
        }

        this.activeDesign = design;

        // Clear the drivers and loads tree data
        this.driversTreeProvider.setTreeData([]);
        this.loadsTreeProvider.setTreeData([]);

        if (design) {
            this.treeData = design.getTreeData();
            this.activeScopeStatusBarItem.text = 'Active scope: ' + design.getActiveScope();
            this.activeScopeStatusBarItem.show();
        } else {
            this.treeData = [];
            this.activeScopeStatusBarItem.hide();
        }

        this.refresh(); // Trigger a refresh of the Netlist view
    }

    public getActiveDesign(): DesignItem | undefined {
        return this.activeDesign;
    }

    public getTreeData(): NetlistItem[] { return this.treeData; }

    getTreeItem(element: NetlistItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: NetlistItem | undefined): vscode.ProviderResult<NetlistItem[]> {
        if (!this.activeDesign) { return []; }
        return this.activeDesign.getChildrenExternal(element) ?? Promise.resolve([]);
    }

    getParent(element: NetlistItem): vscode.ProviderResult<NetlistItem> {
        return element.parent;
    }

    resolveTreeItem?(item: vscode.TreeItem, element: NetlistItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    private async setContextForGoBackOrForward(element: NetlistItem, action: string, isGoBackOrForward: boolean) {
        if (!this.activeDesign) { return; }
        if (!isGoBackOrForward) {
            // Re-navigating to the exact same target we're already at is not a jump — don't record a
            // duplicate history entry (else back/forward would step through identical entries that
            // appear to do nothing).
            if (isNoOpNavigation(this.activeDesign.lastContext, element, action)) { return; }

            if (this.activeDesign.lastContext) {
                this.activeDesign.backwardStack.push(this.activeDesign.lastContext);
                await vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoBackEnabled', true);
            }

            this.activeDesign.forwardStack = []; // Clear forward stack
            await vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoForwardEnabled', false);
        }
        this.activeDesign.lastContext = {
            element: element,
            action: action,
        };
    }

    async gotoDefinition(element: NetlistItem, isGoBackOrForward: boolean = false): Promise<NetlistItem | undefined> {
        if (!this.activeDesign) { return; }

        // Special cases: for these types go to definition is actually go to instantiation
        if (element.type === 'generate' ||
            element.type === 'begin' ||
            element.type === 'clockingblock' ||
            element.type === 'modport' ||
            element.type === 'task' ||
            element.type === 'function' ||
            element.type === 'interfacearray' ||
            element.type === 'scope' || // for slang
            element.type === 'scopearray' || // for slang
            element.type === 'instancearray') // for slang
        {
            return await this.gotoInstantiation(element, isGoBackOrForward);
        }

        // If called from modeuleInstancesView, find the corresponding scopeItem in the hierarchy tree
        if (element.contextValue === 'instanceItem') {
            const scope = await this.activeDesign.findTreeItem(element.fullName);
            if (!scope) {
                console.log('[gotoDefinition] Cannot find in hierarchy tree: ' + element.fullName); // Should not happen
            } else {
                element = scope;
            }
        }

        const fileInfo = await this.activeDesign.getDefinitionFileLocation(element);
        if (fileInfo.filePath) {
            await showTextDocumentLocation(fileInfo.filePath, fileInfo.lineNumber, fileInfo.columnNumber, this.activeDesign.isExample);
        }

        await this.setActiveInstance(element);

        // For varItem, also find drivers and loads for it
        if (element.contextValue === 'varItem') {
            await this.getDriversAndLoads(element);
            await this.setDriversLoadsData(element);
        }

        await this.setContextForGoBackOrForward(element, 'gotoDefinition', isGoBackOrForward);
        return element;
    }

    public async getDriversAndLoads(element: NetlistItem): Promise<void> {
        if (element.contextValue !== 'varItem') { return; }
        if (!this.activeDesign) { return; }
        await this.activeDesign.getDriversAndLoadsExternal(element);
    }

    public async setDriversLoadsData(element: NetlistItem) {
        this.driversTreeProvider.setDriversLoadsData(element.drivers, this.driversView);
        this.loadsTreeProvider.setDriversLoadsData(element.loads, this.loadsView);
    }

    private async setActiveInstance(element: NetlistItem): Promise<boolean> {
        if (!this.activeDesign) { return false; }

        const hasChange = await this.activeDesign.setActiveInstance(element);
        if (!hasChange) { return false; }
        this.activeScopeStatusBarItem.text = 'Active scope: ' + this.activeDesign.getActiveScope();
        this._onDidChangeActiveInstance.fire(this.activeDesign.getActiveInstance());
        return true;
    }

    async goBack() {
        if (!this.activeDesign) { return; }
        if (this.activeDesign.backwardStack.length === 0) { return; }

        if (this.activeDesign.lastContext) { // should always true
            this.activeDesign.forwardStack.push(this.activeDesign.lastContext);
            await vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoForwardEnabled', true);
        }

        const context = this.activeDesign.backwardStack.pop()!;
        if (this.activeDesign.backwardStack.length === 0) {
            await vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoBackEnabled', false);
        }

        if (context.action === 'gotoDefinition') {
            await this.gotoDefinition(context.element, true);
        } else if (context.action === 'gotoInstantiation') {
            await this.gotoInstantiation(context.element, true);
        }
        return context.element;
    }

    async goForward() {
        if (!this.activeDesign) { return; }
        if (this.activeDesign.forwardStack.length === 0) { return; }

        if (this.activeDesign.lastContext) { // should always true
            this.activeDesign.backwardStack.push(this.activeDesign.lastContext);
            await vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoBackEnabled', true);
        }

        const context = this.activeDesign.forwardStack.pop()!;
        if (this.activeDesign.forwardStack.length === 0) {
            await vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoForwardEnabled', false);
        }

        if (context.action === 'gotoDefinition') {
            await this.gotoDefinition(context.element, true);
        } else if (context.action === 'gotoInstantiation') {
            await this.gotoInstantiation(context.element, true);
        }
        return context.element;
    }

    async gotoInstantiation(element: NetlistItem, isGoBackOrForward: boolean = false): Promise<NetlistItem | undefined> {
        if (!this.activeDesign) { return; }
        if (element.contextValue !== 'scopeItem' && element.contextValue !== 'instanceItem') { return; }

        // If called from modeuleInstancesView, find the corresponding scopeItem in the hierarchy tree
        if (element.contextValue === 'instanceItem') {
            const scope = await this.activeDesign.findTreeItem(element.fullName);
            if (!scope) {
                console.log('[gotoInstantiation] Cannot find in hierarchy tree: ' + element.fullName); // Should not happen
                // TODO: error handling, currently setActiveInstance doesn't work if not found
            } else {
                element = scope;
            }
        }

        let parent = element.parent ? element.parent : element; // For top-module, consider itself as parent
        // Find parent recursively until it is a module or interface
        if (parent.type !== 'module' && parent.type !== 'interface') {
            while (parent.parent && parent.type !== 'module' && parent.type !== 'interface') {
                parent = parent.parent;
            }
        }

        await showTextDocumentLocation(element.sourceFile, element.lineNumber, element.columnNumber, this.activeDesign.isExample);
        await this.setActiveInstance(parent);
        await this.setContextForGoBackOrForward(element, 'gotoInstantiation', isGoBackOrForward);
        return element; // should reveal element or parent?
    }

    async addToWaveform(element: NetlistItem, waveformUri: vscode.Uri) {
        let instancePaths = [];
        if (element.contextValue === 'varItem') {
            const hierarchyName = element.getHierarchyName();
            instancePaths.push(hierarchyName);
        } else if (element.contextValue === 'scopeItem') {
            // For scope, add all variables in it
            if (element.children.length === 0) {
                await this.getChildren(element);
            }
            for (const child of element.children) {
                if (child.contextValue === 'varItem') {
                    const hierarchyName = child.getHierarchyName();
                    instancePaths.push(hierarchyName);
                }
            }
        }

        // Show in waveform viewer: reveal:true selects an already-displayed signal instead of
        // adding a duplicate row.
        for (const instancePath of instancePaths) {
            vscode.commands.executeCommand("waveformViewer.addVariable", { uri: waveformUri.toString(), instancePath: instancePath, reveal: true });
        }
    }

    async updateWaveformValuesDescriptions(scope: NetlistItem, waveformValueMap: Map<string, string>) {
        if (scope.contextValue !== 'scopeItem') { return; }
        // Assume children are already loaded
        // if (scope.children.length === 0) {
        //     await this.getChildren(scope);
        // }
        for (const child of scope.children) {
            // Skip parameters as they are constant
            if (child.contextValue === 'varItem' && child.type !== 'parameter') {
                let baseDescription = '';
                if (typeof child.description === 'string') {
                    baseDescription = child.description.split('=')[0].trim();
                }
                if (waveformValueMap.has(child.name)) {
                    child.description = baseDescription + ` = ${waveformValueMap.get(child.name)}`;
                } else {
                    child.description = baseDescription;
                }
            }
        }
        this.refresh();
    }
}

// // #region VariablesTreeProvider
// export class VariablesTreeProvider implements vscode.TreeDataProvider<NetlistItem> {

// }

// #region DriverLoadItem
class DriverLoadItem extends vscode.TreeItem {
    readonly contextValue = 'driverLoadItem';
    constructor(
        public readonly label: string,
        public readonly iconPath: vscode.IconPath,
        public children: FileItem[] = [],
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
    }
}

// #region FileItem
class FileItem extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        public children: NetlistItem[] = [],
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        const filename = path.basename(filePath); // "test.sv"
        const extension = path.extname(filePath); // ".sv"
        const directory = path.dirname(filePath); // "/home/me"

        const label = filename;
        super(label, collapsibleState);
        this.description = directory;
        // get icon path from extension
        if (extension === '.v') {
            this.iconPath = path.join(__dirname, '..', 'media', 'file_type_verilog.svg');
        } else if (extension === '.sv') {
            this.iconPath = {
                light: vscode.Uri.file(path.join(__dirname, '..', 'media', 'file_type_light_systemverilog.svg')),
                dark: vscode.Uri.file(path.join(__dirname, '..', 'media', 'file_type_systemverilog.svg')),
            };
        }
        else if (extension === '.vh' || extension === '.vhd' || extension === '.vhdl') {
            this.iconPath = path.join(__dirname, '..', 'media', 'file_type_vhdl.svg');
        }

        this.tooltip = filePath;
    }
}

async function getLineContent(filePath: string, lineNumber: number): Promise<string> {
    filePath = replaceFilePathIfNeeded(filePath);
    try {
        const document = await vscode.workspace.openTextDocument(filePath);
        const lineContent = document.lineAt(lineNumber - 1).text;
        return lineContent;
    } catch (err) {
        console.error(err);
        return '';
    }
}

// #region DriversLoadsTreeProvider
export class DriversLoadsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private treeData: vscode.TreeItem[] = [];

    constructor(
    ) {
    }

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    public getTreeData(): vscode.TreeItem[] { return this.treeData; }

    public setTreeData(elements: NetlistItem[]) {
        this.treeData = elements;
        this.refresh();
    }

    public async setDriversLoadsData(elements: NetlistItem[], view: vscode.TreeView<vscode.TreeItem>) {
        this.treeData = [];
        const files = new Map<string, FileItem>();
        for (const element of elements) {
            const file = element.sourceFile;
            if (!files.has(file)) {
                files.set(file, new FileItem(file, [], vscode.TreeItemCollapsibleState.Expanded));
            }
            files.get(file)?.children.push(element);
            await this.setDriverLoadInformation(element);
        }
        for (const [_, fileItem] of files) {
            this.treeData.push(fileItem);
        }
        view.description = `${elements.length} results in ${files.size} files`;
        this.refresh();
    }

    private async setDriverLoadInformation(element: NetlistItem) {
        const lineContent = await getLineContent(element.sourceFile, element.lineNumber);
        // Display only first 100 characters
        element.label = lineContent.length > 100 ? lineContent.substring(0, 100) + "..." : lineContent;
        // element.label = lineContent;
        element.description = element.modulePath;
        element.tooltip = "Scope: " + element.modulePath + "\n" + lineContent;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: vscode.TreeItem | undefined): vscode.ProviderResult<vscode.TreeItem[]> {
        if (!element) {
            return Promise.resolve(this.treeData); // Returns top-level netlist items
        }
        if (element instanceof DriverLoadItem) {
            return Promise.resolve(element.children);
        }
        if (element instanceof FileItem) {
            return Promise.resolve(element.children);
        }
        return Promise.resolve([]); // Should not reeach here
    }

    getParent?(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
        return null;
    }

    resolveTreeItem?(item: vscode.TreeItem, element: vscode.TreeItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

// #region ModuleInstancesTreeProvider
export class ModuleInstancesTreeProvider implements vscode.TreeDataProvider<NetlistItem> {
    private activeDesign: DesignItem | undefined = undefined;
    private treeData: NetlistItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<NetlistItem | undefined | null | void> = new vscode.EventEmitter<NetlistItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<NetlistItem | undefined | null | void> = this._onDidChangeTreeData.event;

    public getTreeData(): NetlistItem[] { return this.treeData; }

    // public setTreeData(data: NetlistItem[]) {
    //     this.treeData = data;
    //     this.refresh();
    // }

    public async setActiveDesign(design: DesignItem | undefined) {
        this.activeDesign = design;
        if (design) {
            this.treeData = design.getModuleInstances();
        } else {
            this.treeData = [];
        }

        this._onDidChangeTreeData.fire(undefined); // Trigger a refresh of the Netlist view
    }

    getTreeItem(element: NetlistItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: NetlistItem | undefined): vscode.ProviderResult<NetlistItem[]> {
        if (!this.activeDesign) { return []; }
        return this.activeDesign.getModuleInstancesExternal(element) ?? Promise.resolve([]);
    }

    getParent?(element: NetlistItem): vscode.ProviderResult<NetlistItem> {
        if (element.contextValue === 'moduleDefItem') {
            return element;
        }
        return element.parent; // element.contextValue === 'instanceItem'
    }

    resolveTreeItem?(item: vscode.TreeItem, element: NetlistItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public refreshDesign(design: DesignItem) {
        if (this.activeDesign !== design) { return; }
        this.treeData = design?.getModuleInstances() ?? [];
        this.refresh();
    }
}
