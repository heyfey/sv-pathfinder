// Activation of the slang-server extension before sv-pathfinder uses its commands. Kept out of
// src/slang_server/ (a verbatim copy of upstream's client glue, synced as is).
//
// The extension activates itself only when the workspace contains a .sv/.v file (its activation
// event is `workspaceContains`), so a design opened from a folder without sources, or before that
// search finished, hit "command 'slang.setBuildFile' not found" on every platform.
import * as vscode from 'vscode';

export const SLANG_EXTENSION_ID = 'hudson-river-trading.vscode-slang';

export function slangExtensionMissingMessage(): string {
    return 'The slang-server extension (Hudson-River-Trading.vscode-slang) is not installed. ' +
        'Install it from the Marketplace, or set sv-pathfinder.compiler to "Surelog".';
}

// Activate the extension when it is installed but idle; throw with a user-facing message when it
// is not installed at all (no activation is possible then).
export async function ensureSlangServer(): Promise<void> {
    const ext = vscode.extensions.getExtension(SLANG_EXTENSION_ID);
    if (!ext) { throw new Error(slangExtensionMissingMessage()); }
    if (!ext.isActive) { await ext.activate(); }
}
