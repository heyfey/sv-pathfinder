import * as vscode from 'vscode';

import { OpenedDesignsTreeProvider, HierarchyTreeProvider, DriversLoadsTreeProvider, ModuleInstancesTreeProvider } from './tree_view';
import { EditorMenuProvider, isCursorInModule } from './editor_menu';
import { WaveformValueAnnotationProvider } from './value_annotation';

export function activate(context: vscode.ExtensionContext) {
	console.log('SV Pathfinder: There are venoms and virtues aplenty in the wilds, if you know where to look.');

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

	const moduleInstancesProvider = new ModuleInstancesTreeProvider();
	const moduleInstancesView = vscode.window.createTreeView('moduleInstancesView', {
		treeDataProvider: moduleInstancesProvider,
		manageCheckboxStateManually: false,
		canSelectMany: true,
	});

	const designProvider = new OpenedDesignsTreeProvider(hierarchyProvider, moduleInstancesProvider);

	const editorMenuProvider = new EditorMenuProvider(designProvider, hierarchyView, hierarchyProvider, moduleInstancesView, moduleInstancesProvider);

	// #region External Commands
	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from sv-pathfinder!');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.openDesign', () => {
		vscode.window.registerTreeDataProvider('openedDesignsView', designProvider);
		designProvider.addDesign('/home/heyfey/waveform/Design_kz');
		designProvider.addDesign('/home/heyfey/waveform/Another_Design_kz');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.openWaveform', (e) => {
		designProvider.openWaveform(e);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.revealWaveform', (e) => {
		designProvider.revealWaveform(e);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.selectDesign', (e) => {
		designProvider.selectDesign(e);
		hierarchyView.reveal(e.lastActiveElement, { select: true, focus: false, expand: 1 });
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.gotoDefinition', (e) => {
		hierarchyProvider.gotoDefinition(e);
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

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.goBackward', async (e) => {
		const element = await hierarchyProvider.goBackward();
		if (element) {
			hierarchyView.reveal(element, { select: true, focus: false, expand: 1 });
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.goForward', async (e) => {
		const element = await hierarchyProvider.goForward();
		if (element) {
			hierarchyView.reveal(element, { select: true, focus: false, expand: 1 });
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.selectInstance', (e) => {
		editorMenuProvider.selectInstance();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.traceDriver', (e) => {
		editorMenuProvider.traceDriver();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.traceLoad', (e) => {
		editorMenuProvider.traceLoad();
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

	// #region Editor Menu Commands
	// Only enable tracing commands in the active module.
	// Update context key when the cursor moves. TODO: also need to update context when the active module changes
	// let timeout: NodeJS.Timeout;
	vscode.window.onDidChangeTextEditorSelection(async () => {
		// Delay the check until the user pauses (e.g., 100ms). This reduces calls during rapid movements.
		// clearTimeout(timeout);
		// timeout = setTimeout(() => {
		// Run module check here
		const editor = vscode.window.activeTextEditor;
		const activeDesign = hierarchyProvider.getActiveDesign();
		const activeModule = activeDesign ? activeDesign.getActiveModule() : null;
		if (editor && activeModule &&
			(editor.document.languageId === 'verilog' || editor.document.languageId === 'systemverilog')) {
			// const position = editor.selection.active;
			// const wordRange = editor.document.getWordRangeAtPosition(position);
			// const isWord = !!wordRange; // True if cursor is on a word
			const isEnabled = /*isWord &&*/ await isCursorInModule(activeModule);
			vscode.commands.executeCommand('setContext', 'sv-pathfinder.isCommandEnabled', isEnabled);
		} else {
			vscode.commands.executeCommand('setContext', 'sv-pathfinder.isCommandEnabled', false);
		}
		// }, 100);
	});
	// Set initial state
	vscode.commands.executeCommand('setContext', 'sv-pathfinder.isCommandEnabled', true);


	// #region Value Annotation
	const annotationProvider = new WaveformValueAnnotationProvider(hierarchyProvider);
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
	);

	// Initial update for the active editor
	annotationProvider.debounceUpdateDecorations();
}

// This method is called when your extension is deactivated
export function deactivate() { }
