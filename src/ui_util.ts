// Small vscode-free UI helpers (unit-testable).

export const OPEN_SIDEBAR_ACTION = 'Open sv-pathfinder';
// Auto-generated focus command of the contributed Designs view — executing it reveals the
// sv-pathfinder activity-bar container even when the sidebar is hidden.
export const DESIGNS_VIEW_FOCUS_COMMAND = 'openedDesignsView.focus';

// "No active design" notification: show `message` with an action button that reveals the
// sv-pathfinder sidebar. `show`/`execute` are injected so this stays vscode-free.
export async function showNoActiveDesignMessage(
    message: string,
    show: (message: string, ...items: string[]) => Thenable<string | undefined>,
    execute: (command: string) => Thenable<unknown>,
): Promise<void> {
    const pick = await show(message, OPEN_SIDEBAR_ACTION);
    if (pick === OPEN_SIDEBAR_ACTION) { await execute(DESIGNS_VIEW_FOCUS_COMMAND); }
}
