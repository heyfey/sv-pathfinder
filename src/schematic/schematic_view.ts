// C4/C5/C6/C8 — Schematic webview host, cross-navigation, value annotation, command.
//
// Architecture (see docs/sv-pathfinder-Schematic-Feature-Integration-Plan.md):
//   scope (C1) -> Yosys (C2) -> yosys2digitaljs (C3) -> digitaljs webview (C4)
//   webview click -> source_positions / leaf-name+active-scope -> editor (C5)
//   VaporView marker -> getValuesAtTime -> postMessage -> wire signals (C6)
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { DesignItem, NetlistItem, HierarchyTreeProvider, replaceFilePathIfNeeded, showTextDocumentLocation } from '../tree_view';
import { resolveScope, scopeCacheKey, ScopeContext } from './scope_resolver';
import { runYosys, SchematicPreset } from './yosys_runner';
import { convertToDigitalJs } from './converter';
import { FromWebviewMessage, ToWebviewMessage, ElementClickMessage, ContextActionMessage, ExportRequestMessage, ExportContentMessage, SourcePosition } from './messages';

interface ShownSchematic {
    design: DesignItem;
    instance: NetlistItem;
    ctx: ScopeContext;
    preset: SchematicPreset;
}

export class SchematicViewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private webviewReady = false;
    private pendingMessages: ToWebviewMessage[] = [];
    private current: ShownSchematic | undefined;
    private cache = new Map<string, any>(); // scopeCacheKey -> DigitalJS JSON
    private timestamp = -1;
    private valueTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly hierarchyProvider: HierarchyTreeProvider,
    ) { }

    // #region C8 — entry point
    public async showSchematic(element: NetlistItem | undefined) {
        const design = this.hierarchyProvider.getActiveDesign();
        if (!design) {
            vscode.window.showWarningMessage('sv-pathfinder: open and select a design first.');
            return;
        }
        // Resolve the requested element to a scope instance (same policy as setActiveInstance)
        let instance = element;
        if (instance && instance.contextValue === 'varItem') { instance = instance.parent!; }
        if (instance && instance.contextValue === 'instanceItem') {
            instance = await design.findTreeItem(instance.fullName) ?? instance;
        }
        if (!instance) { instance = design.getActiveInstance(); }
        if (!instance || instance.contextValue !== 'scopeItem') {
            vscode.window.showWarningMessage('sv-pathfinder: select a module instance (scope) to show its schematic.');
            return;
        }

        const preset = this.current?.preset ?? 'rtl';
        await this.render(design, instance, preset);
    }

    private async render(design: DesignItem, instance: NetlistItem, preset: SchematicPreset, force = false) {
        try {
            const ctx = await resolveScope(design, instance);
            this.current = { design, instance, ctx, preset };
            const key = scopeCacheKey(ctx, preset);

            let digitalJsJson = !force ? this.cache.get(key) : undefined;
            if (!digitalJsJson) {
                digitalJsJson = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Schematic: elaborating ${ctx.moduleName} (${preset.toUpperCase()})…`,
                    cancellable: false,
                }, async () => {
                    const result = await runYosys(ctx, preset);
                    return convertToDigitalJs(result.yosysJson);
                });
                this.cache.set(key, digitalJsJson);
            }

            this.createOrRevealPanel();
            this.panel!.title = `Schematic: ${ctx.instancePath}`;
            const cfg = vscode.workspace.getConfiguration('sv-pathfinder');
            const overview = cfg.get<string>('schematicOverview', 'scrollbars') === 'minimap' ? 'minimap' : 'scrollbars';
            const rawSpacing = cfg.get<string>('schematicSpacing', 'compact');
            const spacing = (['compact', 'comfortable', 'spacious'].includes(rawSpacing) ? rawSpacing : 'compact') as
                'compact' | 'comfortable' | 'spacious';
            this.postMessage({
                type: 'loadSchematic',
                circuit: digitalJsJson,
                scopePath: ctx.instancePath,
                moduleName: ctx.moduleName,
                hasParent: findParentScope(instance) !== undefined,
                overview,
                spacing,
            });
            // push current waveform values onto the fresh schematic
            this.debouncePushValues();
        } catch (e: any) {
            vscode.window.showErrorMessage(`sv-pathfinder schematic: ${e?.message ?? e}`);
        }
    }

    // #region C4 — panel & messaging
    private createOrRevealPanel() {
        if (this.panel) {
            this.panel.reveal(undefined, true);
            return;
        }
        this.webviewReady = false;
        this.panel = vscode.window.createWebviewPanel(
            'svPathfinderSchematic', 'Schematic',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true, // keep zoom/layout when tabbed away
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
            });
        this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
        this.panel.webview.onDidReceiveMessage((msg: FromWebviewMessage | { type: string; preset?: string }) => {
            switch (msg.type) {
                case 'ready':
                    this.webviewReady = true;
                    for (const m of this.pendingMessages) { this.panel?.webview.postMessage(m); }
                    this.pendingMessages = [];
                    break;
                case 'elementClick':
                    this.handleElementClick(msg as ElementClickMessage);
                    break;
                case 'contextAction':
                    this.handleContextAction(msg as ContextActionMessage);
                    break;
                case 'export':
                    this.handleExportRequest(msg as ExportRequestMessage);
                    break;
                case 'exportContent':
                    this.handleExportContent(msg as ExportContentMessage);
                    break;
                case 'setPreset': {
                    const preset = (msg as any).preset === 'gls' ? 'gls' : 'rtl';
                    if (this.current && preset !== this.current.preset) {
                        this.render(this.current.design, this.current.instance, preset);
                    }
                    break;
                }
                case 'refresh':
                    if (this.current) {
                        const key = scopeCacheKey(this.current.ctx, this.current.preset);
                        this.cache.delete(key);
                        this.render(this.current.design, this.current.instance, this.current.preset, true);
                    }
                    break;
                case 'goToParent':
                    if (this.current) {
                        const parent = findParentScope(this.current.instance);
                        if (parent) {
                            this.render(this.current.design, parent, this.current.preset);
                        }
                    }
                    break;
            }
        });
        this.panel.onDidDispose(() => {
            this.panel = undefined;
            this.webviewReady = false;
            this.pendingMessages = [];
        });
    }

    // queue messages until the webview signals 'ready' (digitaljs_code's queue pattern)
    private postMessage(msg: ToWebviewMessage) {
        if (this.panel && this.webviewReady) {
            this.panel.webview.postMessage(msg);
        } else {
            this.pendingMessages.push(msg);
        }
    }

    private getWebviewHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'schematic_webview.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'schematic_webview.css'));
        const nonce = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
        // single configurable accent (instance fills + hover highlight); empty → theme color.
        // sanitize to a conservative CSS-color charset so it can't break out of the rule.
        const rawAccent = vscode.workspace.getConfiguration('sv-pathfinder').get<string>('schematicAccentColor', '').trim();
        const accent = /^[#A-Za-z0-9(),.%\s]+$/.test(rawAccent) && rawAccent ? rawAccent : 'var(--vscode-charts-blue)';
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<style>:root { --sv-accent: ${accent}; }</style>
<title>Schematic</title>
</head>
<body>
<div id="toolbar">
  <span id="breadcrumb"></span>
  <span id="toolbar-right">
    <button id="go-parent" class="codicon codicon-arrow-up" title="Go to parent scope" disabled></button>
    <button id="zoom-out" class="codicon codicon-zoom-out" title="Zoom out"></button>
    <button id="zoom-in" class="codicon codicon-zoom-in" title="Zoom in"></button>
    <button id="zoom-fit" class="codicon codicon-screen-full" title="Fit"></button>
    <span id="preset-toggle" class="sv-seg" title="Toggle RTL / Gate-Level view">
      <span class="sv-seg-label active" data-side="rtl">RTL</span>
      <label class="sv-switch"><input type="checkbox" id="preset-switch"><span class="sv-slider"></span></label>
      <span class="sv-seg-label" data-side="gls">Gate-Level</span>
    </span>
    <button id="refresh" class="codicon codicon-refresh" title="Re-run Yosys"></button>
    <button id="export" class="codicon codicon-export" title="Export (SVG / PNG / JSON)"></button>
  </span>
</div>
<div id="paper-container"><div id="paper"></div></div>
<div id="status"><span id="sv-taskbar"></span><span id="status-text"></span></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    // #region C5 — cross-navigation
    private async handleElementClick(msg: ElementClickMessage) {
        const shown = this.current;
        if (!shown) { return; }
        // PRIMARY: source_positions straight off the clicked model (precise, name-independent)
        if (msg.sourcePositions && msg.sourcePositions.length > 0) {
            const pos = msg.sourcePositions.length === 1
                ? msg.sourcePositions[0]
                : await this.pickSourcePosition(msg.sourcePositions);
            if (pos) {
                // Yosys src paths are relative to the yosys cwd (C2 runs in ctx.workDir)
                const filePath = path.isAbsolute(pos.name) ? pos.name : path.resolve(shown.ctx.workDir, pos.name);
                await showTextDocumentLocation(replaceFilePathIfNeeded(filePath), pos.from.line, pos.from.column, shown.design.isExample);
                return;
            }
        }
        // FALLBACK: leaf name + active scope (the norm for wires under the slang frontend);
        // msg.path carries enclosing subcircuit instances for clicks inside popup windows
        if (msg.leafName) {
            const fullName = [shown.ctx.instancePath, ...(msg.path ?? []), msg.leafName].join('.');
            const item = await shown.design.findTreeItem(fullName);
            if (item) {
                const loc = await shown.design.getDefinitionFileLocation(item);
                if (loc.filePath) {
                    await showTextDocumentLocation(loc.filePath, loc.lineNumber, loc.columnNumber, shown.design.isExample);
                    return;
                }
            }
        }
        // celltype = (uniquified) module name of a child box -> module declaration
        if (msg.celltype) {
            await this.gotoModuleDefinition(msg.celltype);
        }
        // neither source positions nor a resolvable name: silently non-navigable (by design)
    }

    // Open the source file of a child module's definition (from its uniquified celltype).
    private async gotoModuleDefinition(celltype: string) {
        const shown = this.current;
        if (!shown) { return; }
        const moduleName = cleanModuleName(celltype);
        const moduleDef = shown.design.getModuleInstances().find(m => m.moduleName === moduleName || m.fullName === moduleName);
        if (moduleDef && moduleDef.sourceFile) {
            await showTextDocumentLocation(moduleDef.sourceFile, moduleDef.lineNumber, moduleDef.columnNumber, shown.design.isExample);
        }
    }

    // Right-click context-menu actions. Reuses the existing tree commands by resolving the
    // clicked element back to a NetlistItem (findTreeItem on its full hierarchical name).
    private async handleContextAction(msg: ContextActionMessage) {
        const shown = this.current;
        if (!shown) { return; }
        const fullName = [shown.ctx.instancePath, ...(msg.path ?? []), msg.leafName].filter(Boolean).join('.');
        switch (msg.action) {
            case 'copyName':
                await vscode.env.clipboard.writeText(fullName);
                vscode.window.setStatusBarMessage(`Copied ${fullName}`, 2000);
                return;
            case 'copyValue':
                if (msg.value !== undefined && msg.value !== '') {
                    await vscode.env.clipboard.writeText(msg.value);
                    vscode.window.setStatusBarMessage(`Copied value ${msg.value}`, 2000);
                }
                return;
            case 'gotoSource':
                // reuse the precise source nav (Yosys source_positions → declaration fallback)
                await this.handleElementClick({ ...msg, type: 'elementClick', action: 'source' } as ElementClickMessage);
                return;
            case 'gotoDefinition': {
                if (msg.kind === 'subcircuit' && msg.celltype) { await this.gotoModuleDefinition(msg.celltype); return; }
                const item = await shown.design.findTreeItem(fullName);
                if (item) { await vscode.commands.executeCommand('sv-pathfinder.gotoDefinition', item); }
                return;
            }
            case 'addToWaveform': {
                const item = await shown.design.findTreeItem(fullName);
                if (item) { await vscode.commands.executeCommand('sv-pathfinder.addToWaveform', item); }
                return;
            }
        }
    }

    // #region export
    // The webview owns the SVG DOM, so it serializes the picture; we just pick the file and
    // write the bytes it sends back (pick format → showSaveDialog → buildExport →
    // exportContent → write). We choose the format with a QuickPick rather than the save
    // dialog's file-type filters: the simple input-box dialog (used on remote/WSL) shows no
    // filter dropdown, so it would silently keep the first format.
    private pendingExportUri?: vscode.Uri;
    private async handleExportRequest(msg: ExportRequestMessage) {
        const shown = this.current;
        if (!shown) { return; }
        const pick = await vscode.window.showQuickPick(
            [
                { label: 'SVG image', description: 'Vector — scalable (.svg)', ext: 'svg' as const },
                { label: 'PNG image', description: 'Bitmap (.png)', ext: 'png' as const },
                { label: 'digitaljs JSON', description: 'Re-loadable circuit data (.json)', ext: 'json' as const },
            ],
            { title: 'Export schematic as', placeHolder: 'Choose a format' },
        );
        if (!pick) { return; }
        const ext = pick.ext;
        const base = (msg.name || shown.ctx.instancePath || shown.ctx.moduleName || 'schematic').replace(/[^\w.-]+/g, '_');
        // Save next to the design by default (ctx.workDir is the design's source dir, always a
        // real path); fall back to the workspace folder, then home. Use an ABSOLUTE path so the
        // dialog doesn't resolve a bare filename at the filesystem root.
        const dirPath = shown.ctx.workDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
        const chosen = await vscode.window.showSaveDialog({
            title: `Export schematic (${ext.toUpperCase()})`,
            defaultUri: vscode.Uri.file(path.join(dirPath, `${base}.${ext}`)),
            filters: { [pick.label]: [ext] },
        });
        if (!chosen) { return; }
        // the format follows the chosen FORMAT, not whatever extension was typed — keep the file
        // extension consistent with the content.
        this.pendingExportUri = path.extname(chosen.fsPath).toLowerCase() === `.${ext}`
            ? chosen
            : chosen.with({ path: `${chosen.path}.${ext}` });
        this.postMessage({ type: 'buildExport', format: ext });
    }
    private async handleExportContent(msg: ExportContentMessage) {
        const uri = this.pendingExportUri;
        this.pendingExportUri = undefined;
        if (!uri) { return; }
        try {
            const bytes = msg.base64 ? Buffer.from(msg.base64, 'base64') : Buffer.from(msg.text ?? '', 'utf8');
            await vscode.workspace.fs.writeFile(uri, bytes);
            vscode.window.showInformationMessage(`Saved schematic to ${path.basename(uri.fsPath)}`);
        } catch (e: any) {
            vscode.window.showErrorMessage(`sv-pathfinder schematic export: ${e?.message ?? e}`);
        }
    }

    private async pickSourcePosition(positions: SourcePosition[]): Promise<SourcePosition | undefined> {
        const items = positions.map(p => ({
            label: `${p.name}:${p.from.line}.${p.from.column}`,
            position: p,
        }));
        const picked = await vscode.window.showQuickPick(items, { title: 'Multiple source locations' });
        return picked?.position;
    }

    // #region C6 — value annotation from VaporView
    public async listenToMarkerSetEvent(): Promise<vscode.Disposable | undefined> {
        const waveformViewer = vscode.extensions.getExtension('lramseyer.vaporview');
        if (!waveformViewer) { return undefined; }
        if (!waveformViewer.isActive) { await waveformViewer.activate(); }
        const api = waveformViewer.exports;
        if (api && api.onDidSetMarker) {
            return api.onDidSetMarker((data: any) => {
                const design = this.current?.design;
                if (!this.panel || !design) { return; }
                if (data.uri.fsPath !== design.getActiveWaveform()?.resourceUri.fsPath) { return; }
                if (data.time === this.timestamp) { return; }
                this.timestamp = data.time;
                this.debouncePushValues();
            });
        }
        return undefined;
    }

    public handleActiveWaveformChanges() {
        if (!this.panel || !this.current) { return; }
        if (!this.current.design.getActiveWaveform()) {
            this.postMessage({ type: 'clearValues' });
        } else {
            this.debouncePushValues();
        }
    }

    private debouncePushValues() {
        clearTimeout(this.valueTimer);
        this.valueTimer = setTimeout(() => { this.pushValues(); }, 100);
    }

    private async pushValues() {
        const shown = this.current;
        if (!this.panel || !shown) { return; }
        const waveform = shown.design.getActiveWaveform();
        if (!waveform) { return; }
        try {
            const instancePaths = await shown.instance.getAllChildVarsNames(shown.design);
            if (instancePaths.length === 0) { return; }
            const waveformValues = await vscode.commands.executeCommand<{ instancePath: string; value: any }[]>(
                'waveformViewer.getValuesAtTime',
                { uri: waveform.resourceUri.toString(), instancePaths });
            if (!waveformValues) { return; }
            const updates: { name: string; value: string }[] = [];
            for (const v of waveformValues) {
                const value = lastWaveformValue(v.value);
                if (value === undefined) { continue; }
                updates.push({ name: v.instancePath.split('.').pop()!, value });
            }
            if (updates.length > 0) {
                this.postMessage({ type: 'setValues', updates });
            }
        } catch (e) {
            console.warn('sv-pathfinder schematic: value push failed', e);
        }
    }
}

// Yosys uniquifies child module names: slang emits `mod$top.path.inst`, the native
// frontend emits `$paramod\mod\PARAM=...`. Resolve back to the plain module name.
// (Keep in sync with the copy in schematic_webview/main.mjs — separate bundles.)
function cleanModuleName(celltype: string): string {
    if (celltype.startsWith('$paramod\\')) {
        const parts = celltype.split('\\');
        return parts[1] || celltype;
    }
    const i = celltype.indexOf('$');
    return i > 0 ? celltype.slice(0, i) : celltype;
}

// Nearest ancestor scope instance of a rendered scope, for "go to parent". The schematic's
// top is always a scopeItem; walk .parent past any scopearray/instancearray wrappers to the
// next scopeItem. Top-level modules have no parent (returns undefined → button disabled).
function findParentScope(instance: NetlistItem): NetlistItem | undefined {
    let p = instance.parent;
    while (p) {
        if (p.contextValue === 'scopeItem') { return p; }
        p = p.parent;
    }
    return undefined;
}

// VaporView returns either a JSON string or an array of value strings (value before /
// after the marker edge); the schematic wants the value AT the cursor = the last one.
function lastWaveformValue(values: any): string | undefined {
    let v: any = values;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { return v; }
    }
    if (Array.isArray(v)) {
        return v.length > 0 ? String(v[v.length - 1]) : undefined;
    }
    return typeof v === 'string' ? v : undefined;
}
