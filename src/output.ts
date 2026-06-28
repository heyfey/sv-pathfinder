import * as vscode from 'vscode';

// The single "sv-pathfinder" output channel, shared by all subsystems. Tag each line with its source
// (e.g. 'schematic', 'surelog') so logs from different parts are distinguishable in one place.
let channel: vscode.OutputChannel | undefined;

export function svOutputChannel(): vscode.OutputChannel {
    if (!channel) { channel = vscode.window.createOutputChannel('sv-pathfinder'); }
    return channel;
}

export function svLog(source: string, message: string): void {
    svOutputChannel().appendLine(`[${source}] ${message}`);
}
