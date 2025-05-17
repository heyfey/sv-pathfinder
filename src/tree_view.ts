import * as vscode from 'vscode';
import path from 'path';

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

        this.name = name;

        this.modulePath = parts.join('.');
        if (this.contextValue === 'moduleDefItem') { this.modulePath = ''; }

        this.command = {
            command: 'sv-pathfinder.gotoDefinition',
            title: 'Go to definition',
            arguments: [this],
        };
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

        const childItem = this.children.find((child) => child.name === currentModule);

        if (childItem) {
            return await childItem.findChild(subModules.join("."), design);
        } else {
            return undefined;
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
    }
}

// #region DesignItem
export class DesignItem extends vscode.TreeItem {
    contextValue = 'designItem';
    readonly iconPath = new vscode.ThemeIcon('file-code');
    readonly resourceUri: vscode.Uri;
    private activeInstance?: NetlistItem | undefined;
    readonly command: vscode.Command;
    // Hierarchy
    public treeData: NetlistItem[] = [];
    public lastActiveElement: NetlistItem | undefined = undefined;
    public backwardStack: NetlistItem[] = [];
    public forwardStack: NetlistItem[] = [];
    // Module Instances
    public moduleInstances: NetlistItem[] = [];

    // Kuzu database
    private db?: any/*kuzu.Database*/ | undefined;

    // Waveform integration
    private waveforms: WaveformItem[] = [];
    private activeWaveform?: WaveformItem | undefined;

    constructor(
        filePath: string,
        collapsibleState?: vscode.TreeItemCollapsibleState,
    ) {
        const filename = path.basename(filePath); // "test.vcd"
        const extension = path.extname(filePath); // ".vcd"
        const directory = path.dirname(filePath); // "/home/me"
        const label = filename;
        super(label, collapsibleState);
        this.description = directory;
        this.resourceUri = vscode.Uri.file(filePath);

        this.command = {
            command: 'sv-pathfinder.selectDesign',
            title: 'Select Design',
            arguments: [this],
        };

        // for testing
        if (filePath === '/home/heyfey/waveform/Design_kz') {
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

    private async loadModuleDefs(conn: any/*kuzu.Connection*/) {
        const query = `MATCH (m:ModuleDef) RETURN m;`;
        const queryResult = await conn.query(query);
        const moduleDefs = await queryResult.getAll();
        for (const moduleDef of moduleDefs) {
            const scope = createScope(moduleDef.m.name, "vhdlarchitecture", moduleDef.m.file, moduleDef.m.lineNo, moduleDef.m.name, "moduleDefItem", undefined);
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
            const scope = createScope(topModule.i.fullName, "module", topModule.i.file, topModule.i.lineNo, moduleName, "scopeItem", undefined);
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

    public async setActiveInstance(element: NetlistItem) {
        let instance;
        instance = element;
        if (element.contextValue === 'scopeItem') {
            instance = element;
        } else if (element.contextValue === 'varItem') {
            instance = element.parent!;
        } else if (element.contextValue === 'loadItem' || element.contextValue === 'driverItem') {
            // find tree item using modulePath
            instance = await this.findTreeItem(element.modulePath);
        }
        if (!instance) {
            console.log('Cannot find instance for ' + element.fullName); // Should not happen
            return;
        }

        this.activeInstance = instance;
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

    public addWaveform(uri: vscode.Uri) {
        this.waveforms = []; // Only allow one waveform per design now, thus clear the old one
        this.waveforms.push(new WaveformItem(uri, this, vscode.TreeItemCollapsibleState.None));
        this.activeWaveform = this.waveforms[0];
    }

    public getWaveforms(): WaveformItem[] {
        return this.waveforms;
    }

    public getActiveWaveform(): WaveformItem | undefined {
        return this.activeWaveform;
    }

    public async findTreeItem(fullName: string): Promise<NetlistItem | undefined> {
        const element = this.treeData.find((element) => element.name === fullName.split('.')[0]);
        if (!element) { return undefined; }
        return await element.findChild(fullName.split('.').slice(1).join('.'), this);
    }
}

// #region OpenedDesignsTreeProvider
export class OpenedDesignsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private designList: DesignItem[] = [];
    // private activeDesign: DesignItem | undefined = undefined;

    constructor(
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly moduleInstancesTreeProvider: ModuleInstancesTreeProvider,
    ) {
    }

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

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

    getParent?(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
        if (element instanceof WaveformItem) {
            return element.design;
        }
        return null;
    }

    resolveTreeItem?(item: vscode.TreeItem, element: vscode.TreeItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    selectDesign(element: DesignItem) {
        if (!element) { return; }
        this.hierarchyTreeProvider.setActiveDesign(element);
        this.moduleInstancesTreeProvider.setActiveDesign(element);
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

    public async openWaveform(element: DesignItem): Promise<boolean> {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Waveform files': ['vcd', 'fst', 'ghw', 'fsdb'],
            }
        };

        const uris = await vscode.window.showOpenDialog(options);
        if (!uris || uris.length === 0) { return false; }
        const selectedFile = uris[0]; // Get the first (and only) selected file
        try {
            await vscode.commands.executeCommand("vaporview.openFile", { uri: selectedFile });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to open waveform: ' + error);
            return false;
        }
        element.addWaveform(selectedFile);
        element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.refresh();
        return true;
    }

    public async revealWaveform(element: WaveformItem) {
        try {
            await vscode.commands.executeCommand("vaporview.openFile", { uri: element.resourceUri });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to open waveform: ' + error);
            return;
        }
    }
}

// #region HierarchyTreeProvider
export class HierarchyTreeProvider implements vscode.TreeDataProvider<NetlistItem> {
    private activeDesign: DesignItem | undefined = undefined;
    private treeData: NetlistItem[] = [];

    private activeScopeStatusBarItem: vscode.StatusBarItem

    constructor(
        public readonly driversView: vscode.TreeView<vscode.TreeItem>,
        public readonly driversTreeProvider: DriversLoadsTreeProvider,
        public readonly loadsView: vscode.TreeView<vscode.TreeItem>,
        public readonly loadsTreeProvider: DriversLoadsTreeProvider,
    ) {
        this.activeScopeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
    }

    private _onDidChangeTreeData: vscode.EventEmitter<NetlistItem | undefined | null | void> = new vscode.EventEmitter<NetlistItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<NetlistItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _onDidChangeActiveInstance: vscode.EventEmitter<NetlistItem | undefined | null | void> = new vscode.EventEmitter<NetlistItem | undefined | null | void>();
    public readonly onDidChangeActiveInstance: vscode.Event<NetlistItem | undefined | null | void> = this._onDidChangeActiveInstance.event;

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

    async gotoDefinition(element: NetlistItem, isGoBackwardOrForward: boolean = false) {
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
        await vscode.window.showTextDocument(uri, { preview: true }).then(() => {
            const range = new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0);
            vscode.window.activeTextEditor?.revealRange(range);
            vscode.window.activeTextEditor!.selection = new vscode.Selection(range.start, range.start);
        });

        await this.setActiveInstance(element);

        // For varItem, also find drivers and loads for it
        if (element.contextValue === 'varItem') {
            await this.getDriversAndLoads(element);
            await this.setDriversLoadsData(element);
        }

        if (!isGoBackwardOrForward) {
            if (this.activeDesign.lastActiveElement) {
                this.activeDesign.backwardStack.push(this.activeDesign.lastActiveElement);
                vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoBackwardEnabled', true);
            }

            this.activeDesign.forwardStack = []; // Clear forward stack
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoForwardEnabled', false);
        }
        this.activeDesign.lastActiveElement = element;
    }

    public async getDriversAndLoads(element: NetlistItem): Promise<void> {
        if (element.contextValue !== 'varItem') { return; }
        if (!this.activeDesign) { return; }
        await this.activeDesign.getDriversAndLoads(element);
    }

    public async setDriversLoadsData(element: NetlistItem) {
        this.driversTreeProvider.setDriversLoadsData(element.drivers, this.driversView);
        this.loadsTreeProvider.setDriversLoadsData(element.loads, this.loadsView);
    }

    private async setActiveInstance(element: NetlistItem) {
        if (!this.activeDesign) { return; }

        await this.activeDesign.setActiveInstance(element);
        this.activeScopeStatusBarItem.text = 'Active scope: ' + this.activeDesign.getActiveScope();
        this._onDidChangeActiveInstance.fire(this.activeDesign.getActiveInstance());
    }

    async goBackward() {
        if (!this.activeDesign) { return; }
        if (this.activeDesign.backwardStack.length === 0) { return; }

        if (this.activeDesign.lastActiveElement) { // should always true
            this.activeDesign.forwardStack.push(this.activeDesign.lastActiveElement);
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoForwardEnabled', true);
        }

        const element = this.activeDesign.backwardStack.pop()!;
        if (this.activeDesign.backwardStack.length === 0) {
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoBackwardEnabled', false);
        }
        this.gotoDefinition(element, true);

        return element;
    }

    async goForward() {
        if (!this.activeDesign) { return; }
        if (this.activeDesign.forwardStack.length === 0) { return; }

        if (this.activeDesign.lastActiveElement) { // should always true
            this.activeDesign.backwardStack.push(this.activeDesign.lastActiveElement);
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoBackwardEnabled', true);
        }

        const element = this.activeDesign.forwardStack.pop()!;
        if (this.activeDesign.forwardStack.length === 0) {
            vscode.commands.executeCommand('setContext', 'sv-pathfinder.isGoForwardEnabled', false);
        }
        this.gotoDefinition(element, true);

        return element;
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

        // Add to waveform viewer
        for (const instancePath of instancePaths) {
            vscode.commands.executeCommand("waveformViewer.addVariable", { uri: waveformUri.toString(), instancePath: instancePath });
        }
    }
}

// // #region VariablesTreeProvider
// export class VariablesTreeProvider implements vscode.TreeDataProvider<NetlistItem> {

// }

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
    }
}

async function getLineContent(filePath: string, lineNumber: number): Promise<string> {
    filePath = filePath.replace("ABC", "/home/heyfey"); // TODO
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
