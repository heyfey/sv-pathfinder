import * as vscode from 'vscode';
import path from 'path';

import { HierarchyTreeProvider, DesignItem } from './tree_view';
import { shouldWarnStaleSource } from './staleness';

// Warns once (per loaded design) when a SystemVerilog/Verilog source file is saved after the design
// was loaded — at which point the hierarchy, schematic, and waveform value annotations may no longer
// match the source. The user can reload the design from the prompt, or suppress the warning entirely.
export class SourceStalenessMonitor {
    private static readonly SUPPRESS_KEY = 'sv-pathfinder.suppressStaleSourceWarning';
    // Per-design "already warned" state; cleared when a design is reloaded so the next edit warns again.
    private readonly warned = new WeakSet<DesignItem>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly hierarchyProvider: HierarchyTreeProvider,
    ) {}

    public register(): vscode.Disposable {
        return vscode.workspace.onDidSaveTextDocument((doc) => this.onSave(doc));
    }

    // Call when a design is reloaded so its derived views are fresh again and a later edit re-warns.
    public resetForDesign(design: DesignItem | undefined): void {
        if (design) { this.warned.delete(design); }
    }

    private async onSave(doc: vscode.TextDocument): Promise<void> {
        const design = this.hierarchyProvider.getActiveDesign();
        const suppressed = this.context.globalState.get<boolean>(SourceStalenessMonitor.SUPPRESS_KEY, false);
        if (!shouldWarnStaleSource({
            languageId: doc.languageId,
            suppressed,
            hasActiveDesign: !!design,
            isExample: !!design?.isExample,
            alreadyWarned: !!design && this.warned.has(design),
        })) { return; }

        this.warned.add(design!);
        const reload = 'Reload Design';
        const suppress = "Don't show again";
        const pick = await vscode.window.showWarningMessage(
            `A source file (${path.basename(doc.fileName)}) was saved after the design was loaded. ` +
            `The hierarchy, schematic, and waveform value annotations may now be out of date — reload the design to refresh.`,
            reload, suppress,
        );
        if (pick === reload) {
            await vscode.commands.executeCommand('sv-pathfinder.reloadDesign', design);
        } else if (pick === suppress) {
            await this.context.globalState.update(SourceStalenessMonitor.SUPPRESS_KEY, true);
        }
    }
}
