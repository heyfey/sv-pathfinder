// Back/forward navigation history helpers (vscode-free so they can be unit-tested).
//
// The hierarchy view records a history entry on each navigation so the back/forward buttons can
// replay it. Clicking the SAME tree item repeatedly is not a real jump — nothing moved — so it must
// NOT create a new history entry, otherwise back/forward step through identical entries that look
// like they do nothing.

export interface NavContext<T> {
    element: T;
    action: string;
}

// A navigation is a no-op (should not be recorded in history) when it targets the exact same element
// with the same action as the last recorded context. Reference identity on `element` matches the
// "clicked the same tree item again" case; the action guard still lets e.g. definition-vs-
// instantiation of the same element be recorded as distinct jumps.
export function isNoOpNavigation<T>(last: NavContext<T> | undefined, element: T, action: string): boolean {
    return !!last && last.element === element && last.action === action;
}

// One editor group, described by its column id and the file paths of the tabs it holds.
export interface EditorGroupPaths<C> {
    column: C;
    paths: string[];
}

// Find the column of an already-open tab for `targetPath`, scanning ALL groups (so background tabs
// count, not just each group's visible editor). Returns undefined if the file isn't open anywhere —
// the caller then falls back to opening it in the active group. This is what makes "go to source"
// jump to an existing split instead of opening a duplicate.
export function findColumnForPath<C>(groups: EditorGroupPaths<C>[], targetPath: string): C | undefined {
    for (const group of groups) {
        if (group.paths.some((p) => p === targetPath)) { return group.column; }
    }
    return undefined;
}
