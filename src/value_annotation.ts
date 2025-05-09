import * as vscode from 'vscode';

import { HierarchyTreeProvider, ModuleInstancesTreeProvider, NetlistItem } from './tree_view';

const decorationType = vscode.window.createTextEditorDecorationType({
    // color: 'blue', // Decorates variable text in blue
    before: {
        contentText: ' [var]',
        // contentText: '[0xAE->0x8B] ',
        color: 'lightblue'
    }
});

export class WaveformValueAnnotationProvider {
    constructor(
        private readonly hierarchyView: vscode.TreeView<NetlistItem>,
        private readonly hierarchyTreeProvider: HierarchyTreeProvider,
        private readonly moduleInstancesTreeProvider: ModuleInstancesTreeProvider,
    ) {
    }
    public async updateDecorations(editor: vscode.TextEditor) {
        if (!editor || editor.document.languageId !== 'verilog') {
            return;
        }
        const document = editor.document;
        // Get document symbols
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        if (!symbols) {
            return;
        }

        const moduleSymbol = symbols.find(
            // 4 in svlangserver
            // 5 in Verible
            symbol => symbol.name === 'ALUB' && symbol.kind === 9 /*symbol.kind === vscode.SymbolKind.Module*/
        );
        if (!moduleSymbol) {
            return;
        }
        const moduleRange = moduleSymbol.range;

        // Get all unique variables within the module
        const variables = [];
        const nameSet = new Set();
        for (const child of moduleSymbol.children) {
            if ((child.kind === 12 || child.kind === 7) && !nameSet.has(child.name)) {
                nameSet.add(child.name);
                variables.push(child);
            }
        }
        
        const allRanges = [];

        // For each variable, find all occurrences
        for (const variable of variables) {
            const position = variable.selectionRange.start;
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                position
            );
            if (references) {
                // Filter references within the module scope
                const filteredReferences = references.filter(
                    ref => ref.uri.toString() === document.uri.toString() &&
                        moduleRange.contains(ref.range)
                );
                allRanges.push(...filteredReferences.map(ref => ref.range));
                // Shift the range by 1 character to the left
                // allRanges.push(...filteredReferences.map(ref => {
                //     const range = ref.range;
                //     const newStartChar = Math.max(0, range.start.character - 1);
                //     const newEndChar = Math.max(0, range.end.character - 1);
                //     const newStart = range.start.with({ character: newStartChar });
                //     const newEnd = range.end.with({ character: newEndChar });
                //     return new vscode.Range(newStart, newEnd);
                // }));
            }
        }
        // Apply decorations
        editor.setDecorations(decorationType, allRanges);
    }
}