// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { OpenedDesignsTreeProvider, HierarchyTreeProvider, ModuleInstancesTreeProvider } from './tree_view';
import { EditorMenuProvider, isCursorInModule } from './editor_menu';
// import { WaveformValueCodeLensProvider } from './codelens';
import { WaveformValueAnnotationProvider } from './value_annotation';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "sv-pathfinder" is now active!');

	const hierarchyProvider = new HierarchyTreeProvider();
	const moduleInstancesProvider = new ModuleInstancesTreeProvider();
	const designProvider = new OpenedDesignsTreeProvider(hierarchyProvider, moduleInstancesProvider);

	const hierarchyView = vscode.window.createTreeView('hierarchyView', {
		treeDataProvider: hierarchyProvider,
		manageCheckboxStateManually: false,
		canSelectMany: true,
	});
	
	// vscode.window.registerTreeDataProvider('hierarchyView', hierarchyProvider);
	vscode.window.registerTreeDataProvider('driversView', hierarchyProvider.driversTreeProvider);
	vscode.window.registerTreeDataProvider('loadsView', hierarchyProvider.loadsTreeProvider);
	vscode.window.registerTreeDataProvider('moduleInstancesView', moduleInstancesProvider);

	const editorMenuProvider = new EditorMenuProvider(hierarchyView, hierarchyProvider, moduleInstancesProvider);
	const annotationProvider = new WaveformValueAnnotationProvider(hierarchyView, hierarchyProvider, moduleInstancesProvider);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	// const disposable = vscode.commands.registerCommand('sv-pathfinder.helloWorld', () => {
	// 	// The code you place here will be executed every time your command is executed
	// 	// Display a message box to the user
	// 	vscode.window.showInformationMessage('Hello World from sv-pathfinder!');
	// });

	// context.subscriptions.push(disposable);

	// Commands
	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from sv-pathfinder!');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.openDesign', () => {
		vscode.window.registerTreeDataProvider('openedDesignsView', designProvider);
		designProvider.addDesign('/home/heyfey/waveform/Design_kz');
		designProvider.addDesign('/home/heyfey/waveform/Another_Design_kz');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.selectDesign', (e) => {
		designProvider.selectDesign(e);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.gotoDefinition', (e) => {
		hierarchyProvider.gotoDefinition(e);
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

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.showInWaveform', (e) => {
		editorMenuProvider.showInWaveform();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('sv-pathfinder.copyHierarchyName', (e) => {
		editorMenuProvider.copyHierarchyName();
	}));

	// Only enable tracing commands in the active module.
	// Update context key when the cursor moves.
	// let timeout: NodeJS.Timeout;
	vscode.window.onDidChangeTextEditorSelection(async () => {
		// Delay the check until the user pauses (e.g., 100ms). This reduces calls during rapid movements.
		// clearTimeout(timeout);
		// timeout = setTimeout(() => {
		// Run module check here
		const editor = vscode.window.activeTextEditor;
		const activeDesign = hierarchyProvider.getActiveDesign();
		const activeModule = activeDesign ? activeDesign.getActiveModule() : null;
		if (editor && activeModule && editor.document.languageId === 'verilog') {
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


	// context.subscriptions.push(
    //     vscode.languages.registerCodeLensProvider(
    //         { language: 'verilog' },
    //         new WaveformValueCodeLensProvider()
    //     )
    // );

	// Update decorations when the active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                annotationProvider.updateDecorations(editor);
            }
        })
    );

	// Update decorations when the document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                annotationProvider.updateDecorations(editor);
            }
        })
    );

	// Initial update for the active editor
    if (vscode.window.activeTextEditor) {
        annotationProvider.updateDecorations(vscode.window.activeTextEditor);
    }
}

// This method is called when your extension is deactivated
export function deactivate() { }
