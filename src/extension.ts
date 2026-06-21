import * as vscode from 'vscode';

import { OpenedDesignsTreeProvider, HierarchyTreeProvider, DriversLoadsTreeProvider, ModuleInstancesTreeProvider, showModulesViewEnabled } from './tree_view';
import { EditorMenuProvider } from './editor_menu';
import { WaveformValueAnnotationProvider } from './value_annotation';
import { Parser } from './parser';
import { SchematicViewProvider } from './schematic/schematic_view';
import { SourceStalenessMonitor } from './source_staleness';

export function activate(context: vscode.ExtensionContext) {
	console.log('sv-pathfinder: there are venoms and virtues aplenty in the wilds, if you know where to look.');

	// #region TreeView
	const driversProvider = new DriversLoadsTreeProvider();
	const driversView = vscode.window.createTreeView('driversView', {
		treeDataProvider: driversProvider,
		manageCheckboxStateManually: false,
		canSelectMany: true,
	});

	const loadsProvider = new DriversLoadsTreeProvider();
	const loadsView = vscode.window.createTreeView('loadsView', {
		treeDataProvider: loadsProvider,
		manageCheckboxStateManually: false,
		canSelectMany: true,
	});

	const hierarchyProvider = new HierarchyTreeProvider(driversView, driversProvider, loadsView, loadsProvider);
	const hierarchyView = vscode.window.createTreeView('hierarchyView', {
		treeDataProvider: hierarchyProvider,
		manageCheckboxStateManually: false,
		canSelectMany: true,
	});
	hierarchyProvider.setHierarchyTreeView(hierarchyView); // for reveal-when-visible

	const moduleInstancesProvider = new ModuleInstancesTreeProvider();
	const moduleInstancesView = vscode.window.createTreeView('moduleInstancesView', {
		treeDataProvider: moduleInstancesProvider,
		manageCheckboxStateManually: false,
		canSelectMany: true,
	});
	// Set initial state only on extension activation
	// If the setting is changed, need to reload the window to take effect
	if (showModulesViewEnabled()) {
		vscode.commands.executeCommand('setContext', 'sv-pathfinder.moduleInstancesViewVisible', true);
	}

	const designProvider = new OpenedDesignsTreeProvider(hierarchyProvider, moduleInstancesProvider);
	const designsView = vscode.window.createTreeView('openedDesignsView', {
		treeDataProvider: designProvider,
		manageCheckboxStateManually: false,
		canSelectMany: false,
	});

	context.subscriptions.push(
		designsView.onDidChangeCheckboxState((event) => {
			for (const [item, state] of event.items) {
				if (state === vscode.TreeItemCheckboxState.Checked) {
					designProvider.handleCheckWaveformItem(item);
				} else if (state === vscode.TreeItemCheckboxState.Unchecked) {
					designProvider.handleUncheckWaveformItem(item);
				}
			}
		})
	);

	const parser = new Parser();
	const editorMenuProvider = new EditorMenuProvider(designProvider, hierarchyView, hierarchyProvider, moduleInstancesView, parser);

	// #region External Commands
	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.openDesign', async () => {
		designProvider.openDesign();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.openExampleDesign', () => {
		designProvider.openExampleDesign();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.closeDesign', (e) => {
		designProvider.closeDesign(e);
	}));

	const stalenessMonitor = new SourceStalenessMonitor(context, hierarchyProvider);
	context.subscriptions.push(stalenessMonitor.register());

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.reloadDesign', async (e) => {
		await designProvider.reloadDesign(e);
		stalenessMonitor.resetForDesign(e); // views are fresh again → allow a future stale warning
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.openWaveform', async (e) => {
		const element = await designProvider.openWaveform(e);
		if (element) {
			designsView.reveal(element, { select: true, focus: false, expand: 1 });
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.revealWaveform', (e) => {
		designProvider.revealWaveform(e);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.closeWaveform', (e) => {
		designProvider.closeWaveform(e);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.selectDesign', async (e) => {
		await designProvider.selectDesign(e);
		hierarchyProvider.revealIfVisible(e.lastContext?.element);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.gotoDefinition', async (e) => {
		const element = await hierarchyProvider.gotoDefinition(e);
		// If called from moduleInstancesView, reveal the corresponding scope in hierarchyView (only
		// when that view is open — never force it open).
		if (e.contextValue === 'instanceItem') {
			hierarchyProvider.revealIfVisible(element);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.gotoInstantiation', async (e) => {
		const element = await hierarchyProvider.gotoInstantiation(e);
		// If called from moduleInstancesView, reveal the corresponding scope in hierarchyView (only
		// when that view is open — never force it open).
		if (e.contextValue === 'instanceItem') {
			hierarchyProvider.revealIfVisible(element);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.copyName', (e) => {
		vscode.env.clipboard.writeText(e.getHierarchyName());
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.addToWaveform', async (e) => {
		await addToWaveform(e);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.addAllInScopeToWaveform', async (e) => {
		await addToWaveform(e);
	}));

	async function addToWaveform(e: any) {
		const activeDesign = hierarchyProvider.getActiveDesign()!;
		await designProvider.openWaveformIfNotPresent(activeDesign);
		const activeWaveform = activeDesign.getActiveWaveform();
		if (activeWaveform) {
			hierarchyProvider.addToWaveform(e, activeWaveform.resourceUri);
		}
	}

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.searchDesign', async () => {
		await hierarchyProvider.searchDesign();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.goBack', async (e) => {
		const element = await hierarchyProvider.goBack();
		// back/forward change the active scope even when the hierarchy view is closed; only reveal
		// when it's open (don't force it open).
		hierarchyProvider.revealIfVisible(element);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.goForward', async (e) => {
		const element = await hierarchyProvider.goForward();
		hierarchyProvider.revealIfVisible(element);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.selectInstance', (e) => {
		editorMenuProvider.selectInstance();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.traceDriver', (e) => {
		editorMenuProvider.traceDriverOrLoad(true/*traceDriver*/);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.traceLoad', (e) => {
		editorMenuProvider.traceDriverOrLoad(false/*traceDriver*/);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.showInHierarchyView', (e) => {
		editorMenuProvider.showInHierarchyView();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.addToWaveformViewer', (e) => {
		editorMenuProvider.addToWaveformViewer();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.copyHierarchyName', (e) => {
		editorMenuProvider.copyHierarchyName();
	}));

	// #region Schematic
	const schematicProvider = new SchematicViewProvider(context, hierarchyProvider);
	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.showSchematic', async (e) => {
		await schematicProvider.showSchematic(e);
	}));
	// Editor context-menu variant: resolve the scope for the module under the cursor (the active
	// instance if it matches, else that module's single instance) without changing the active scope.
	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.showSchematicFromEditor', async () => {
		const scope = await editorMenuProvider.resolveScopeForCursorModule();
		if (scope) { await schematicProvider.showSchematic(scope); }
	}));
	schematicProvider.listenToMarkerSetEvent().then(disposable => {
		if (disposable) { context.subscriptions.push(disposable); }
	});

	// #region Value Annotation
	const annotationProvider = new WaveformValueAnnotationProvider(hierarchyProvider, parser);
	annotationProvider.listenToMarkerSetEventEvent().then(disposable => {
		if (disposable) {
			// Register the disposable for cleanup on deactivation
			context.subscriptions.push(disposable);
		}
	});

	context.subscriptions.push(
		// vscode.window.onDidChangeTextEditorVisibleRanges(() => annotationProvider.debounceUpdateDecorations()),
		// vscode.window.onDidChangeActiveTextEditor(() => annotationProvider.debounceUpdateDecorations()),
		vscode.window.onDidChangeVisibleTextEditors(() => annotationProvider.handleChangeVisibleTextEditors()),
		vscode.workspace.onDidChangeTextDocument((e) => annotationProvider.handleChangeTextDocument(e)),
		hierarchyProvider.onDidChangeActiveInstance((e) => annotationProvider.handleActiveInstanceChanges(e)),
		designProvider.onDidChangeActiveWaveformForActiveDesign((e) => annotationProvider.handleActiveWaveformChanges(e)),
		designProvider.onDidChangeActiveWaveformForActiveDesign(() => schematicProvider.handleActiveWaveformChanges()),
	);

	// Initial update for the active editor
	annotationProvider.debounceUpdateDecorations();
}

// This method is called when your extension is deactivated
export function deactivate() { }
