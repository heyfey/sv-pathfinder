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
import { runYosys, SchematicPreset, getResolvedBackendName, isResolvedBackendLimited } from './yosys_runner';
import { convertToDigitalJs, extractSubtree, rootRelativeYosysPath, pickCoveringRoot } from './converter';
import { findParentModuleScope } from './scope_nav';
import { cleanCelltype } from './celltype';
import { isNoYosysBackendError, limitedBackendWarning } from './backend_policy';
import { FromWebviewMessage, ToWebviewMessage, ElementClickMessage, ContextActionMessage, ExpandRequestMessage, ExportRequestMessage, ExportContentMessage, SourcePosition } from './messages';

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
    private cache = new Map<string, any>(); // scopeCacheKey -> DigitalJS JSON (per-scope: shallow + full-fallback)
    // full mode: each entry is an elaboration rooted at a scope the user opened/ascended-to; descendants
    // render by extraction. Keyed `${design}|${preset}(+dangling)|${rootInstancePath}`.
    private fullCircuitCache = new Map<string, { rootModule: string; rootInstancePath: string; circuit: any }>();
    private timestamp = -1;
    private valueTimer: NodeJS.Timeout | undefined;
    private limitedBackendWarned = false; // one-time-per-session warning for the limited fallback
    private static readonly SUPPRESS_LIMITED_KEY = 'sv-pathfinder.suppressLimitedBackendWarning';
    private static readonly SUPPRESS_PARAM_KEY = 'sv-pathfinder.suppressParamWarning';

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
            const cfg = vscode.workspace.getConfiguration('sv-pathfinder');
            // Optional: surface declared-but-unconnected nets. In the cache key so toggling the
            // setting + reloading re-elaborates (it changes the Yosys keeps + converter output).
            const showDangling = cfg.get<boolean>('schematicShowDanglingNets', false);
            const shallow = cfg.get<string>('schematicElaborationMode', 'full') === 'shallow';

            // full mode: elaborate the whole design once, render this scope by extracting its subtree.
            // Falls back to a per-scope elaboration if the scope isn't found in the whole-design circuit
            // (e.g. a generate-name quirk). shallow mode: elaborate this scope + 1 level on demand.
            let digitalJsJson = !shallow
                ? await this.renderFromFullCircuit(design, ctx, preset, showDangling, force)
                : undefined;
            if (!digitalJsJson) {
                digitalJsJson = await this.elaborateScope(ctx, preset, showDangling, shallow, force);
            }

            this.createOrRevealPanel();
            this.panel!.title = `Schematic: ${ctx.instancePath}`;
            const overview = cfg.get<string>('schematicOverview', 'scrollbars') === 'minimap' ? 'minimap' : 'scrollbars';
            const rawSpacing = cfg.get<string>('schematicSpacing', 'compact');
            const spacing = (['compact', 'comfortable', 'spacious'].includes(rawSpacing) ? rawSpacing : 'compact') as
                'compact' | 'comfortable' | 'spacious';
            this.postMessage({
                type: 'loadSchematic',
                circuit: digitalJsJson,
                scopePath: ctx.instancePath,
                moduleName: ctx.moduleName,
                hasParent: findParentModuleScope(instance) !== undefined,
                overview,
                spacing,
                backend: getResolvedBackendName(),
                limited: isResolvedBackendLimited(),
                shallow, // webview: in shallow mode a child box has no loaded internals → expand re-elaborates
            });
            // push current waveform values onto the fresh schematic
            this.debouncePushValues();
            this.maybeWarnLimitedBackend();
            // Param-override caveat only applies to shallow's per-scope elaboration; full mode
            // elaborates from the real top so every scope's params are in-context accurate.
            if (shallow) { this.maybeWarnSkippedParams(ctx); }
        } catch (e: any) {
            this.showRenderError(e);
        }
    }

    // Per-scope elaboration (shallow mode, and the full-mode fallback): run Yosys rooted at this
    // scope. `shallow` blackboxes the direct children (selected + 1 level). Cached per scope.
    private async elaborateScope(ctx: ScopeContext, preset: SchematicPreset, showDangling: boolean, shallow: boolean, force: boolean): Promise<any> {
        const key = scopeCacheKey(ctx, preset) + (showDangling ? '+dangling' : '') + (shallow ? '+shallow' : '');
        let json = !force ? this.cache.get(key) : undefined;
        if (!json) {
            json = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Schematic: elaborating ${ctx.moduleName}${shallow ? ' (+1 level)' : ''} (${preset.toUpperCase()})…`,
                cancellable: false,
            }, async () => {
                const result = await runYosys(ctx, preset, { showDangling, shallow });
                return convertToDigitalJs(result.yosysJson, { showDangling });
            });
            this.cache.set(key, json);
        }
        return json;
    }

    // Full mode: render the shown scope by EXTRACTING it from a cached elaboration that covers it
    // (the scope itself or an ancestor the user opened/ascended-to) — no re-elaboration. Only when no
    // cached root covers the scope (or on a forced refresh) do we elaborate THIS scope's own subtree
    // and cache it as a new root. Rooting at the shown scope (not the design's absolute top) avoids
    // elaborating a non-synthesizable testbench above the DUT. Returns the circuit to post.
    private async renderFromFullCircuit(design: DesignItem, ctx: ScopeContext, preset: SchematicPreset, showDangling: boolean, force: boolean): Promise<any> {
        const prefix = `${design.resourceUri.fsPath}|${preset}${showDangling ? '+dangling' : ''}|`;
        if (!force) {
            const roots = [...this.fullCircuitCache.entries()].filter(([k]) => k.startsWith(prefix));
            const cover = pickCoveringRoot(roots.map(([, v]) => v.rootInstancePath), ctx.instancePath);
            const entry = cover !== undefined ? roots.find(([, v]) => v.rootInstancePath === cover)?.[1] : undefined;
            if (entry) {
                const relPath = rootRelativeYosysPath(entry.rootModule, entry.rootInstancePath, ctx.instancePath);
                const sub = relPath !== undefined ? extractSubtree(entry.circuit, ctx.moduleName, relPath, entry.rootModule) : undefined;
                if (sub) { return sub; } // covered → extract, no re-elaboration
            }
        }
        // Not covered (or forced): elaborate this scope's subtree as a new root.
        const circuit = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Schematic: elaborating ${ctx.moduleName} (${preset.toUpperCase()})…`,
            cancellable: false,
        }, async () => {
            const result = await runYosys(ctx, preset, { showDangling });
            return convertToDigitalJs(result.yosysJson, { showDangling });
        });
        this.fullCircuitCache.set(prefix + ctx.instancePath, { rootModule: ctx.moduleName, rootInstancePath: ctx.instancePath, circuit });
        return circuit;
    }

    // Enum/struct/array (and other non-scalar) parameters can't be overridden in Yosys (see
    // collectParamOverrides), so the scope is drawn with the module default — possibly inaccurate if
    // this instance overrides one to a non-default value (we can't detect that, hence "possibly").
    // Name each param + its declaration location so the user knows what to sanity-check. Suppressible.
    // Skipped for a TOP-level scope: there a param IS its module default, so the drawing is accurate.
    private async maybeWarnSkippedParams(ctx: ScopeContext) {
        const skipped = ctx.skippedParams;
        if (!skipped || skipped.length === 0) { return; }
        if (!ctx.instancePath.includes('.')) { return; } // top scope: params == defaults, no inaccuracy
        if (this.context.globalState.get<boolean>(SchematicViewProvider.SUPPRESS_PARAM_KEY, false)) { return; }
        // Name each param with its declaration location ("RV32ZC (ibex_compressed_decoder.sv:17)").
        const list = skipped.map(p => p.file ? `${p.name} (${path.basename(p.file)}:${p.line})` : p.name).join(', ');
        const goto = skipped.find(p => p.file);               // first one with a known location
        const gotoBtn = goto ? `Go to ${goto.name}` : undefined;
        const suppress = "Don't show again";
        const buttons = gotoBtn ? [gotoBtn, suppress] : [suppress];
        const pick = await vscode.window.showWarningMessage(
            `Schematic for ${ctx.moduleName}: parameter${skipped.length > 1 ? 's' : ''} ${list} ` +
            `${skipped.length > 1 ? 'are' : 'is'} drawn at the module default — Yosys can't apply the ` +
            `instance's value (enum/struct/array-typed), so the structure may be inaccurate if it ` +
            `differs from the default.`,
            ...buttons);
        if (gotoBtn && pick === gotoBtn && goto?.file) {
            await showTextDocumentLocation(goto.file, goto.line ?? 1, goto.column ?? 1, !!this.current?.design.isExample);
        } else if (pick === suppress) {
            await this.context.globalState.update(SchematicViewProvider.SUPPRESS_PARAM_KEY, true);
        }
    }

    // Warn once per session when the schematic was rendered with the limited (yowasp) fallback, so a
    // partial/incorrect render isn't mistaken for a bug in the design or this extension.
    private async maybeWarnLimitedBackend() {
        if (this.limitedBackendWarned || !isResolvedBackendLimited()) { return; }
        if (this.context.globalState.get<boolean>(SchematicViewProvider.SUPPRESS_LIMITED_KEY, false)) { return; }
        this.limitedBackendWarned = true;
        const settings = 'Open Settings';
        const suppress = "Don't show again";
        const pick = await vscode.window.showWarningMessage(
            limitedBackendWarning(getResolvedBackendName() ?? 'yowasp-yosys'), settings, suppress);
        if (pick === settings) {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'sv-pathfinder.ossCadSuitePath');
        } else if (pick === suppress) {
            await this.context.globalState.update(SchematicViewProvider.SUPPRESS_LIMITED_KEY, true);
        }
    }

    // Surface a render failure. The "no Yosys backend" case gets an actionable button to the setting
    // that fixes it instead of a dead-end message.
    private async showRenderError(e: any) {
        const msg = `sv-pathfinder schematic: ${e?.message ?? e}`;
        if (isNoYosysBackendError(e)) {
            const settings = 'Open Settings';
            const pick = await vscode.window.showErrorMessage(msg, settings);
            if (pick === settings) {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'sv-pathfinder.ossCadSuitePath');
            }
        } else {
            vscode.window.showErrorMessage(msg);
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
                case 'expandRequest':
                    this.handleExpandRequest(msg as ExpandRequestMessage);
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
                        const parent = findParentModuleScope(this.current.instance);
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
    <button id="go-parent" class="codicon codicon-debug-step-out" title="Go to parent scope" disabled></button>
    <button id="sv-find-btn" class="codicon codicon-search" title="Find signal / instance (Ctrl+F)"></button>
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

    // Resolve a scope NetlistItem at a path RELATIVE to the rendered scope (current.instance). Empty
    // path → the rendered scope itself. Walks the in-memory tree first (children already loaded),
    // falling back to an absolute lookup. Used to pick the scope to make active after a nav.
    private async resolveScopeByRelPath(relParts: (string | undefined)[]): Promise<NetlistItem | undefined> {
        const shown = this.current;
        if (!shown) { return undefined; }
        const relPath = relParts.filter(Boolean).join('.');
        if (!relPath) { return shown.instance; }
        const fullName = [shown.ctx.instancePath, relPath].filter(Boolean).join('.');
        return await shown.instance.findChild(relPath, shown.design) ?? await shown.design.findTreeItem(fullName);
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
            case 'stepInto': {
                // re-render the MAIN page at the child instance's scope (like go-to-parent, inward).
                // Resolve by walking DOWN the in-memory tree from the already-rendered scope
                // (current.instance) along the RELATIVE path — the mirror of go-to-parent's `.parent`
                // walk. This anchors on the exact rendered scope (no root re-lookup / full-path
                // re-parse), and its direct children are already loaded (resolveScope →
                // getChildrenExternal), so the common case is an in-memory lookup. Fall back to the
                // absolute findTreeItem if the local walk misses.
                const relPath = [...(msg.path ?? []), msg.leafName].filter(Boolean).join('.');
                const child = await shown.instance.findChild(relPath, shown.design)
                    ?? await shown.design.findTreeItem(fullName);
                if (child) { await this.render(shown.design, child, shown.preset); return; }
                // Tree miss: the schematic engine (Yosys) drew this instance, but the navigation index
                // (slang) doesn't have it — typically the design's filelist (.f) omits the module's
                // source, so the language server couldn't elaborate it (e.g. ibex's ibex_core.f omits
                // ibex_wb_stage.sv). Don't dead-click: explain, and offer the instantiation site, which
                // navigates off Yosys source positions (no tree item needed).
                const mod = msg.celltype ? cleanCelltype(msg.celltype) : undefined;
                const canSource = (msg.sourcePositions?.length ?? 0) > 0;
                // In full mode the whole-design elaboration includes this instance even when the slang
                // tree doesn't, so "Expand" opens it client-side — point the user there.
                const fullMode = vscode.workspace.getConfiguration('sv-pathfinder')
                    .get<string>('schematicElaborationMode', 'full') !== 'shallow';
                const gotoSrc = 'Go to source';
                const pick = await vscode.window.showWarningMessage(
                    `Can't step into ${msg.leafName}${mod ? ` (module ${mod})` : ''}: it's drawn by the ` +
                    `schematic engine but isn't in the navigation hierarchy (the design's filelist ` +
                    `doesn't include the module's source, so it wasn't elaborated for navigation).` +
                    (fullMode ? ` Use "Expand" to open it in a popup instead.` : ''),
                    ...(canSource ? [gotoSrc] : []));
                if (pick === gotoSrc) {
                    await this.handleElementClick({ ...msg, type: 'elementClick', action: 'source' } as ElementClickMessage);
                }
                return;
            }
            case 'gotoSource': {
                // reuse the precise source nav (Yosys source_positions → declaration fallback)
                await this.handleElementClick({ ...msg, type: 'elementClick', action: 'source' } as ElementClickMessage);
                // Source lands in the CONTAINER scope — a net's declaration, or a child instance's
                // INSTANTIATION in the parent — so activate that container (the rendered scope on the
                // main page; the popup's scope for nested clicks), NOT the child instance itself.
                const scope = await this.resolveScopeByRelPath(msg.path ?? []);
                if (scope) { await this.hierarchyProvider.activateScope(scope); }
                return;
            }
            case 'gotoDefinition': {
                if (msg.kind === 'subcircuit' && msg.celltype) {
                    await this.gotoModuleDefinition(msg.celltype);
                    // Definition lands in the child module → activate the child instance's scope.
                    const scope = await this.resolveScopeByRelPath([...(msg.path ?? []), msg.leafName]);
                    if (scope) { await this.hierarchyProvider.activateScope(scope); }
                    return;
                }
                const item = await shown.design.findTreeItem(fullName);
                if (item) {
                    await vscode.commands.executeCommand('sv-pathfinder.gotoDefinition', item); // sets active scope
                    this.hierarchyProvider.revealIfVisible(item);                                // follow if the tree is open
                }
                return;
            }
            case 'addToWaveform': {
                const item = await shown.design.findTreeItem(fullName);
                if (item) { await vscode.commands.executeCommand('sv-pathfinder.addToWaveform', item); }
                return;
            }
        }
    }

    // Shallow mode: a blackboxed child box has no loaded internals, so "Expand" re-elaborates the
    // child (selected + 1) on demand; the webview opens the returned circuit in a popup. Resolve the
    // child like stepInto; if it isn't in the slang tree (off-tree), elaborate its module standalone
    // by celltype. Replies with expandResult{key, circuit} (or {key, error}; the box stays a box).
    private async handleExpandRequest(msg: ExpandRequestMessage) {
        const shown = this.current;
        if (!shown) { return; }
        try {
            const showDangling = vscode.workspace.getConfiguration('sv-pathfinder')
                .get<boolean>('schematicShowDanglingNets', false);
            const relPath = [...(msg.path ?? []), msg.leafName].filter(Boolean).join('.');
            const fullName = [shown.ctx.instancePath, relPath].filter(Boolean).join('.');
            const child = await shown.instance.findChild(relPath, shown.design)
                ?? await shown.design.findTreeItem(fullName);
            let childCtx: ScopeContext;
            if (child) {
                childCtx = await resolveScope(shown.design, child);
            } else {
                const mod = msg.celltype ? cleanCelltype(msg.celltype) : undefined;
                if (!mod) { this.postMessage({ type: 'expandResult', key: msg.key, error: `Can't resolve ${msg.leafName}` }); return; }
                // Off-tree: elaborate the module standalone (its own defaults), reusing this design's files.
                childCtx = { instancePath: fullName || mod, moduleName: mod, resolvedParams: [], skippedParams: [], childModules: [], dotF: shown.ctx.dotF, fileSet: shown.ctx.fileSet, workDir: shown.ctx.workDir };
            }
            const circuit = await this.elaborateScope(childCtx, shown.preset, showDangling, /*shallow*/ true, false);
            this.postMessage({ type: 'expandResult', key: msg.key, circuit });
        } catch (e: any) {
            this.postMessage({ type: 'expandResult', key: msg.key, error: String(e?.message ?? e) });
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
                // vaporview's MarkerSetEvent.uri is a string, not a vscode.Uri, so parse it
                // before comparing fsPath (otherwise data.uri.fsPath is always undefined and
                // every marker event is dropped — the colors-don't-update bug).
                if (vscode.Uri.parse(data.uri).fsPath !== design.getActiveWaveform()?.resourceUri.fsPath) { return; }
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
            const updates: { name: string; values: string[] }[] = [];
            for (const v of waveformValues) {
                const values = waveformValueArray(v.value);
                if (values.length === 0) { continue; }
                updates.push({ name: v.instancePath.split('.').pop()!, values });
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

// VaporView returns either a JSON string or an array of value strings (value before /
// after the marker edge); the schematic wants the value AT the cursor = the last one.
// The full value array vaporview reports for a net AT the cursor: one value when stable, [old, new]
// on a transition, or [old, …, final] for a glitch. Normalize vaporview's shape (a JSON-string or
// a real array) to string[]; the webview joins the chain and colours by the last element.
function waveformValueArray(values: any): string[] {
    let v: any = values;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { return v ? [v] : []; }
    }
    if (Array.isArray(v)) { return v.map(String); }
    return typeof v === 'string' && v ? [v] : [];
}
