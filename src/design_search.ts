// Global "find instance in design" — types + the pure pieces (vscode-free, unit-testable).
//
// Approach (mirrors slang-server's fuzzyFindInstance and VaporView): the backend enumerates the
// instance list; we present it in a QuickPick and let VS Code's built-in fuzzy filter do the
// matching against the full instance path. The TreeView stays lazy — we never build it to search.

export interface InstanceSearchResult {
    instPath: string;   // clean full hierarchy path (no backend prefix) — used for both display and
                        // navigation (findTreeItem). Backends strip any internal prefix before here.
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

// Result of a capped search: up to `results.length` items (sorted by path), and `total` = how many
// matched overall (so the UI can show "showing N of M"). Mirrors the UHDM addon's return shape.
export interface InstanceSearchHits {
    total: number;
    results: InstanceSearchResult[];
}

// Case-insensitive subsequence match — true when every char of `query` occurs in `candidate` in
// order; empty query matches everything. Mirrors the UHDM addon's FuzzySubseqMatch and slang-server's
// fuzzyMatch, so the slang (JS) and UHDM (native) backends rank identically.
export function fuzzySubsequenceMatch(query: string, candidate: string): boolean {
    const q = query.toLowerCase();
    const c = candidate.toLowerCase();
    let qi = 0;
    for (let ci = 0; qi < q.length && ci < c.length; ci++) {
        if (q[qi] === c[ci]) { qi++; }
    }
    return qi === q.length;
}

// Filter a full instance list by `query` (subsequence on instPath), count the total matches, and cap
// to maxResults (sorted by path). The slang backend uses this client-side over its cached enumeration
// (slang-server exposes no instance-search command); the UHDM backend does the equivalent natively.
export function filterAndCapInstances(all: InstanceSearchResult[], query: string, maxResults: number): InstanceSearchHits {
    const matched = all.filter((r) => fuzzySubsequenceMatch(query, r.instPath));
    matched.sort((a, b) => a.instPath.localeCompare(b.instPath));
    const results = maxResults > 0 ? matched.slice(0, maxResults) : matched;
    return { total: matched.length, results };
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
