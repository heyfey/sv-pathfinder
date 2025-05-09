import * as vscode from 'vscode';

// Must use require instead of import somehow
const kuzu = require("kuzu");

// Scopes
const moduleIcon = new vscode.ThemeIcon('chip', new vscode.ThemeColor('charts.purple'));
const taskIcon = new vscode.ThemeIcon('debug-stack-frame', new vscode.ThemeColor('charts.blue'));
const funcIcon = new vscode.ThemeIcon('symbol-module', new vscode.ThemeColor('charts.blue'));
const beginIcon = new vscode.ThemeIcon('debug-start', new vscode.ThemeColor('charts.blue'));
const forkIcon = new vscode.ThemeIcon('repo-forked', new vscode.ThemeColor('charts.blue'));
const structIcon = new vscode.ThemeIcon('symbol-structure', new vscode.ThemeColor('charts.blue'));
const unionIcon = new vscode.ThemeIcon('surround-with', new vscode.ThemeColor('charts.blue'));
const classIcon = new vscode.ThemeIcon('symbol-misc', new vscode.ThemeColor('charts.blue'));
const interfaceIcon = new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.purple'));
const packageIcon = new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.purple'));
const scopeIcon = new vscode.ThemeIcon('symbol-module', new vscode.ThemeColor('charts.purple'));

export function createScope(fullName: string, type: string, file: string, lineNumber: number, moduleName: string, contextValue: string, parent: NetlistItem | undefined) {

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
    }

    const module = new NetlistItem(fullName, typename, file, lineNumber, moduleName, contextValue, parent, [], vscode.TreeItemCollapsibleState.Collapsed);
    module.iconPath = icon;

    return module;
}

// Variables
const regIcon = new vscode.ThemeIcon('symbol-array', new vscode.ThemeColor('charts.green'));
const wireIcon = new vscode.ThemeIcon('symbol-interface', new vscode.ThemeColor('charts.pink'));
const intIcon = new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('charts.green'));
const paramIcon = new vscode.ThemeIcon('settings', new vscode.ThemeColor('charts.green'));
const realIcon = new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.orange'));
const defaultIcon = new vscode.ThemeIcon('file-binary', new vscode.ThemeColor('charts.green'));
const stringIcon = new vscode.ThemeIcon('symbol-key', new vscode.ThemeColor('charts.yellow'));
const portIcon = new vscode.ThemeIcon('plug', new vscode.ThemeColor('charts.green'));
const timeIcon = new vscode.ThemeIcon('watch', new vscode.ThemeColor('charts.green'));

export function createVar(fullName: string, type: string, file: string, lineNumber: number, moduleName: string, contextValue: string, parent: NetlistItem | undefined) {
    //   const field = bitRangeString(msb, lsb);

    // field is already included in signal name for fsdb
    //   if (!isFsdb) name = name + field;

    const variable = new NetlistItem(fullName, type, file, lineNumber, moduleName, contextValue, parent, [], vscode.TreeItemCollapsibleState.None);
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
        case 'bit': { icon = defaultIcon; break; }
        case 'logic': { icon = defaultIcon; break; }
        case 'int': { icon = intIcon; break; }
        case 'shortint': { icon = intIcon; break; }
        case 'longint': { icon = intIcon; break; }
        case 'byte': { icon = defaultIcon; break; }
        case 'enum': { icon = defaultIcon; break; }
        case 'shortreal': { icon = defaultIcon; break; }
        case 'boolean': { icon = defaultIcon; break; }
        case 'bitvector': { icon = defaultIcon; break; }
        case 'stdlogic': { icon = defaultIcon; break; }
        case 'stdlogicvector': { icon = defaultIcon; break; }
        case 'stdulogic': { icon = defaultIcon; break; }
        case 'stdulogicvector': { icon = defaultIcon; break; }
        case 'net': { icon = wireIcon; break; }
    }

    variable.iconPath = icon;
    //   if ((typename === 'wire') || (typename === 'reg') || (icon === defaultIcon)) {
    //     if (width > 1) {variable.iconPath = regIcon;}
    //     else           {variable.iconPath = wireIcon;}
    //   }

    return variable;
}

export class NetlistItem extends vscode.TreeItem {
    public readonly modulePath: string;
    public readonly command: vscode.Command;

    // Only used by variables
    public drivers: NetlistItem[] = [];
    public loads: NetlistItem[] = [];

    constructor(
        public readonly fullName: string,
        public readonly type: string,
        public readonly sourceFile: string,
        public readonly lineNumber: number,
        public readonly moduleName: string,
        public readonly contextValue: string,
        public readonly parent: NetlistItem | undefined,
        public children: NetlistItem[] = [],
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        const parts = fullName.split('.');
        const name = parts.pop() || '';
        let label = fullName;
        if (contextValue === 'varItem' || contextValue === 'scopeItem') {
            label = name;
        }
        super(label, collapsibleState);

        this.modulePath = parts.join('.');
        if (this.contextValue === 'moduleDefItem') { this.modulePath = ''; }

        this.command = {
            command: 'sv-pathfinder.gotoDefinition',
            title: 'Go to definition',
            arguments: [this],
        };
    }
}

export class DesignItem extends vscode.TreeItem {
    // contextValue = 'designItem';
    readonly iconPath = new vscode.ThemeIcon('file-code');
    readonly resourceUri: vscode.Uri;
    private activeInstance?: NetlistItem | undefined; // can be scope or var now
    readonly command: vscode.Command;
    // Hierarchy
    public treeData: NetlistItem[] = [];
    // Module Instances
    public moduleInstances: NetlistItem[] = [];

    // Kuzu database
    // private db?: kuzu.Database | undefined;
    private db?: any | undefined;

    // Waveform integration
    private waveformDatabaseUri?: vscode.Uri | undefined;
    private currentTime?: number | undefined;

    constructor(
        label: string,
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
        this.resourceUri = vscode.Uri.file(label);

        this.command = {
            command: 'sv-pathfinder.selectDesign',
            title: 'Select Design',
            arguments: [this],
        };

        // for testing
        if (label === '/home/heyfey/waveform/Design_kz') {
            this.load();
        }
    }

    async load() {
        // console.log(this.resourceUri.fsPath);
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Reading design database: " + this.resourceUri.fsPath,
                cancellable: false
            }, async () => {
                this.db = new kuzu.Database(this.resourceUri.fsPath, 0, true, true, 0);
                const conn = new kuzu.Connection(this.db);
                await this.loadModuleDefs(conn);
                await this.loadTopModules(conn);
            });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load design database: ' + error);
            return;
        }
    }

    private async loadModuleDefs(conn: kuzu.Connection) {
        const query = `MATCH (m:ModuleDef) RETURN m;`;
        const queryResult = await conn.query(query);
        const moduleDefs = await queryResult.getAll();
        for (const moduleDef of moduleDefs) {
            const scope = createScope(moduleDef.m.name, "vhdlarchitecture", moduleDef.m.file, moduleDef.m.lineNo, moduleDef.m.name, "moduleDefItem", undefined);
            // scope.description = moduleDef.m.file;
            this.moduleInstances.push(scope);
        }
    }

    private async loadTopModules(conn: kuzu.Connection) {
        const query = `MATCH (i:Instance) WHERE i.isTopModule = true RETURN i;`;
        const queryResult = await conn.query(query);
        const topModules = await queryResult.getAll();
        for (const topModule of topModules) {
            const moduleName = await this.getModuleName(conn, topModule.i.fullName) || "unknown";
            const scope = createScope(topModule.i.fullName, "module", topModule.i.file, topModule.i.lineNo, moduleName, "scopeItem", undefined);
            scope.description = moduleName;
            this.treeData.push(scope);
        }
    }

    private async getModuleName(conn: kuzu.Connection, instanceName: string): Promise<string | undefined> {
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
            const scope = createScope(subInstance.sub_i.fullName, "module", subInstance.sub_i.file, subInstance.sub_i.lineNo, moduleName, "scopeItem", element);
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
            const v = createVar(variable.v.fullName, variable.v.type, variable.v.file, variable.v.lineNo, element.moduleName, "varItem", element);
            result.push(v);
        }
        return result;
    }

    public async getDriversAndLoads(element: NetlistItem): Promise<void> {
        if (element.drivers.length > 0 || element.loads.length > 0) { return; }
        const conn = new kuzu.Connection(this.db);
        const query = `MATCH (v:Variable {fullName: "${element.fullName}"})-[:driver]->(dvr:Assignment) RETURN dvr;`;
        const queryResult = await conn.query(query);
        const drivers = await queryResult.getAll();
        // console.log(drivers);
        for (const driver of drivers) {
            const dvr = createVar(driver.dvr.fullName, "driver", driver.dvr.file, driver.dvr.lineNo, "TODO", "driverItem", element);
            // console.log(driver.dvr);
            element.drivers.push(dvr);
        }

        const query2 = `MATCH (v:Variable {fullName: "${element.fullName}"})-[:load]->(ld:Assignment) RETURN ld;`;
        const queryResult2 = await conn.query(query2);
        const loads = await queryResult2.getAll();
        // console.log(loads);
        for (const load of loads) {
            const ld = createVar(load.ld.fullName, "load", load.ld.file, load.ld.lineNo, "TODO", "loadItem", element);
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
        const conn = new kuzu.Connection(this.db);
        const query = `MATCH (m:ModuleDef {name: "${element.fullName}"})-[:instantiate]->(i:Instance) RETURN m,i;`;
        const queryResult = await conn.query(query);
        const instances = await queryResult.getAll();
        for (const instance of instances) {
            const scope = createVar(instance.i.fullName, "event", instance.i.file, instance.i.lineNo, instance.m.name, "instanceItem", element);
            scope.description = instance.m.name;
            element.children.push(scope);
        }
        return element.children;
    }

    public setActiveInstance(element: NetlistItem) {
        this.activeInstance = element.contextValue === 'varItem' ? element.parent : element;
        // TODO: How about drivers and loads?
    }

    public getActiveInstance() {
        return this.activeInstance;
    }

    public getActiveScope(): string {
        const activeInstance = this.activeInstance ? this.activeInstance : undefined;
        if (activeInstance === undefined) {
            return '';
        }
        let activeScope = activeInstance.modulePath;
        if (activeInstance.contextValue === 'scopeItem') {
            const label = typeof activeInstance.label === 'string' ? activeInstance.label : '';
            activeScope = activeScope === '' ? label : activeScope + '.' + label;
        } else if (activeInstance.contextValue === 'instanceItem') {
            activeScope = activeInstance.fullName;
        }
        return activeScope;
    }

    public getActiveModule(): string | undefined {
        return this.activeInstance?.moduleName;
    }
}

// #region OpenedDesignsTreeProvider
export class OpenedDesignsTreeProvider implements vscode.TreeDataProvider<DesignItem> {
    private designList: DesignItem[] = [];
    // private activeDesign: DesignItem | undefined = undefined;

    constructor(
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly moduleInstancesTreeProvider: ModuleInstancesTreeProvider,
    ) {
    }

    onDidChangeTreeData?: vscode.Event<void | DesignItem | DesignItem[] | null | undefined> | undefined;
    private _onDidChangeTreeData: vscode.EventEmitter<void | DesignItem | DesignItem[] | null | undefined> = new vscode.EventEmitter<void | DesignItem | DesignItem[] | null | undefined>();

    addDesign(designPath: string) {
        let index = this.designList.findIndex(design => design.label === designPath);
        if (index < 0) {
            const design = new DesignItem(designPath);
            this.designList.push(design);
        } else {
            // this.designList[index] = database;
            // reveal the design
        }
        this.refresh();
        // return this.designList.length;
    }

    getTreeItem(element: DesignItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: DesignItem | undefined): vscode.ProviderResult<DesignItem[]> {
        return Promise.resolve(this.designList);
    }

    getParent?(element: DesignItem): vscode.ProviderResult<DesignItem> {
        return null;
    }

    resolveTreeItem?(item: vscode.TreeItem, element: DesignItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    selectDesign(element: DesignItem) {
        if (!element) { return; }
        this.hierarchyTreeProvider.setActiveDesign(element);
        this.moduleInstancesTreeProvider.setActiveDesign(element);
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

// #region HierarchyTreeProvider
export class HierarchyTreeProvider implements vscode.TreeDataProvider<NetlistItem> {
    private activeDesign: DesignItem | undefined = undefined;
    private treeData: NetlistItem[] = [];

    private activeScopeStatusBarItem: vscode.StatusBarItem

    public readonly driversTreeProvider: DriversLoadsTreeProvider;
    public readonly loadsTreeProvider: DriversLoadsTreeProvider;

    constructor(

    ) {
        this.driversTreeProvider = new DriversLoadsTreeProvider();
        this.loadsTreeProvider = new DriversLoadsTreeProvider();
        this.activeScopeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
    }

    private _onDidChangeTreeData: vscode.EventEmitter<NetlistItem | undefined | null | void> = new vscode.EventEmitter<NetlistItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<NetlistItem | undefined | null | void> = this._onDidChangeTreeData.event;

    public setActiveDesign(design: DesignItem) {
        this.activeDesign = design;
        this.treeData = design.treeData;

        this.activeScopeStatusBarItem.text = 'Active scope: ' + design.getActiveScope();
        this.activeScopeStatusBarItem.show();

        this._onDidChangeTreeData.fire(undefined); // Trigger a refresh of the Netlist view
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

    async gotoDefinition(element: NetlistItem) {
        if (!this.activeDesign) { return; }
        
        let filePath = element.sourceFile;
        let lineNumber = element.lineNumber;
        if (element.contextValue === 'scopeItem' || element.contextValue === 'instanceItem') {
            // sourceFile and lineNumber for scopeItem and instanceItem is where it get instantiated.
            // Find definition in its moduleDef.
            const moduleName = element.description; // module name is stored in description
            let index = this.activeDesign.moduleInstances.findIndex(module => module.fullName === moduleName);
            if (index < 0) {
                console.log('Cannot find module definition for ' + moduleName);
                return;
            } else {
                filePath = this.activeDesign.moduleInstances[index].sourceFile;
                lineNumber = this.activeDesign.moduleInstances[index].lineNumber;
            }
        }
        filePath = filePath.replace("ABC", "/home/heyfey"); // TODO

        const uri = vscode.Uri.file(filePath);
        vscode.window.showTextDocument(uri, { preview: true }).then(() => {
            const range = new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0);
            vscode.window.activeTextEditor?.revealRange(range);
            vscode.window.activeTextEditor!.selection = new vscode.Selection(range.start, range.start);
        });

        this.activeDesign.setActiveInstance(element);
        this.activeScopeStatusBarItem.text = 'Active scope: ' + this.activeDesign.getActiveScope();

        // Also find drivers and loads for varItem
        if (element.contextValue === 'varItem') {
            await this.activeDesign.getDriversAndLoads(element);
            this.driversTreeProvider.setTreeData(element.drivers);
            this.loadsTreeProvider.setTreeData(element.loads);
        }
    }
}

// // #region VariablesTreeProvider
// export class VariablesTreeProvider implements vscode.TreeDataProvider<NetlistItem> {

// }

// #region DriversLoadsTreeProvider
export class DriversLoadsTreeProvider implements vscode.TreeDataProvider<NetlistItem> {
    private treeData: NetlistItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<NetlistItem | undefined | null | void> = new vscode.EventEmitter<NetlistItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<NetlistItem | undefined | null | void> = this._onDidChangeTreeData.event;

    public getTreeData(): NetlistItem[] { return this.treeData; }

    public setTreeData(data: NetlistItem[]) {
        this.treeData = data;
        this.refresh();
    }

    getTreeItem(element: NetlistItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: NetlistItem | undefined): vscode.ProviderResult<NetlistItem[]> {
        return Promise.resolve(this.treeData);
    }

    getParent?(element: NetlistItem): vscode.ProviderResult<NetlistItem> {
        return null;
    }

    resolveTreeItem?(item: vscode.TreeItem, element: NetlistItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
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

    public setActiveDesign(design: DesignItem) {
        this.activeDesign = design;
        this.treeData = design.moduleInstances;

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
        return null;
    }

    resolveTreeItem?(item: vscode.TreeItem, element: NetlistItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}
