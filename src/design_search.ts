// Global "find instance in design" — types + the pure pieces (vscode-free, unit-testable).
//
// Approach (mirrors slang-server's fuzzyFindInstance and VaporView): the backend enumerates the
// instance list; we present it in a QuickPick and let VS Code's built-in fuzzy filter do the
// matching against the full instance path. The TreeView stays lazy — we never build it to search.

export interface InstanceSearchResult {
    instPath: string;   // full hierarchy path, e.g. tb.u_fifo.gen_blk[0].cell
    declName: string;   // module/declaration name (shown as the item description)
    file: string;
    line: number;       // 1-based
    column: number;     // 1-based
}

// A QuickPick item carrying enough to navigate on accept. label = leaf instance name (what you
// scan for), detail = full path (matched via matchOnDetail), description = module name.
export interface InstanceQuickPickItem {
    label: string;
    description: string;
    detail: string;
    result: InstanceSearchResult;
}

// Leaf instance name of a hierarchy path (the part after the last '.'), preserving any [index].
export function leafName(instPath: string): string {
    const dot = instPath.lastIndexOf('.');
    return dot >= 0 ? instPath.slice(dot + 1) : instPath;
}

// Build QuickPick items from raw results. Deterministic order (by path) so the list is stable before
// the user types and VS Code's fuzzy ranking kicks in.
export function toInstanceQuickPickItems(results: InstanceSearchResult[]): InstanceQuickPickItem[] {
    return results
        .slice()
        .sort((a, b) => a.instPath.localeCompare(b.instPath))
        .map((r) => ({
            label: leafName(r.instPath),
            description: r.declName,
            detail: r.instPath,
            result: r,
        }));
}
