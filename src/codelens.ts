import * as vscode from 'vscode';

export class WaveformValueCodeLensProvider implements vscode.CodeLensProvider {
    public async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];

        // Step 1: Get document symbols
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        if (!symbols) {
            return codeLenses; // No symbols available
        }
        console.log(symbols);

        // Step 2: Find the "top" module
        const moduleSymbol = symbols.find(
            symbol => symbol.name === 'ALUB' && symbol.kind === 9 /*symbol.kind === vscode.SymbolKind.Module*/
        );

        if (!moduleSymbol) {
            return codeLenses; // "top" module not found
        }

        const topRange = moduleSymbol.range;

        // Step 3: Get all unique variables within "top"
        const variables = [];
        const nameSet = new Set();

        for (const child of moduleSymbol.children) {
            if ((child.kind === 12 || child.kind === 7) && !nameSet.has(child.name)) {
                nameSet.add(child.name);
                variables.push(child);
            }
        }

        console.log(variables);

        // for (const variable of variables) {
        //     const codeLens = new vscode.CodeLens(variable.range, {
        //         // title: `Variable: ${variable.name}`,
        //         title: '0->1',
        //         command: '' // Optional: Add a command here
        //     });
        //     codeLenses.push(codeLens);
        // }

        // Step 4: Process each variable
        for (const variable of variables) {
            const declarationPosition = variable.selectionRange.start;

            // Get all references to this variable
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                declarationPosition
            );
            console.log(references);
            if (references) {
                // Step 5: Filter references within "top" and create CodeLens
                // for (const ref of references) {
                //     if (topRange.contains(ref.range)) {
                //         const codeLens = new vscode.CodeLens(ref.range, {
                //             // title: `Variable: ${variable.name}`,
                //             title: '0->1',
                //             command: '' // Optional: Add a command here
                //         });
                //         codeLenses.push(codeLens);
                //     }
                // }
                // Create a CodeLens for each reference
            for (const ref of references) {
                console.log(ref.range.start.line + '-> ' + ref.range.start.character + ':' + ref.range.end.character);
                const range = new vscode.Range(
                    new vscode.Position(ref.range.start.line, ref.range.start.character+20),
                    new vscode.Position(ref.range.end.line, ref.range.start.character+20)
                );

                const lens = new vscode.CodeLens(range, {
                    title: `${variable.name}: 0->1`, // Displayed text in the editor
                    command: ""       // No command, just a label (customize as needed)
                });
                codeLenses.push(lens);
            }
            }
        }

        return codeLenses;
    }
}