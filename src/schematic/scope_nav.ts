// Pure scope-tree navigation (no vscode import) so it can be unit-tested. A "scope node" is anything
// with parent / contextValue / type — a NetlistItem at runtime.
export interface ScopeNode {
    parent?: ScopeNode;
    contextValue?: string;
    type?: string;
}

// Nearest ancestor that is a renderable MODULE instance, for the schematic's "go to parent". Skips
// non-module scopes that the schematic can't render on their own: generate blocks (slang gives them
// type 'scope'/'scopearray'; the native frontend 'generate'/'begin') and instance arrays
// ('instancearray'). Those carry the ENCLOSING module's moduleName/params, so resolving them as a
// scope feeds Yosys the wrong top/params and the render fails — land on the real module instance
// whose schematic contains the current scope instead. Returns undefined at the top (no parent →
// the "go to parent" button stays disabled).
export function findParentModuleScope<T extends ScopeNode>(instance: T): T | undefined {
    let p = instance.parent as T | undefined;
    while (p) {
        if (p.contextValue === 'scopeItem' && p.type === 'module') { return p; }
        p = p.parent as T | undefined;
    }
    return undefined;
}

// A SystemVerilog interface PORT can't be elaborated as a standalone Yosys top — the interface has
// nothing to connect to (read_slang: "unconnected interface port" / "interface port on blackbox").
export function isInterfaceTopError(e: any): boolean {
    return /unconnected interface port|interface port on blackbox/.test(String(e?.message ?? e));
}

// read_slang errors that typically mean a scope was elaborated in ISOLATION with a parameter missing:
// a struct/enum/array config that -G can't carry (e.g. CVA6's CVA6Cfg) falls back to a bogus default,
// so width counts go non-positive / out of range and config-typed structs collapse to 1-bit logic.
export function isParamResolutionError(e: any): boolean {
    return /value must be positive|invalid member access for type|cannot select range of|range-oob|endianness of selection must match/
        .test(String(e?.message ?? e));
}

// Why (if at all) a FAILED standalone elaboration should be retried from a top-able ancestor that
// supplies the missing context (then extract this scope's subtree). Two scopes can't stand alone:
//  - 'interface' — an interface port (see above); fires regardless of parent (the ancestor walk
//    reports cleanly when there is none).
//  - 'params' — the scope's config comes from a parameter we couldn't reconstruct via Yosys -G (a
//    struct/enum/array, e.g. CVA6's `CVA6Cfg`, skipped by collectParamOverrides). Detected two ways,
//    either of which is sufficient: we recorded a skipped param for this scope, OR Yosys emitted a
//    width/type error that is the hallmark of a missing config param (isParamResolutionError). Only
//    meaningful with a parent to root at; otherwise the failure is genuine, not an isolation artifact.
export function ancestorFallbackReason(
    err: any, skippedParamCount: number, hasParent: boolean): 'interface' | 'params' | undefined {
    if (isInterfaceTopError(err)) { return 'interface'; }
    if (hasParent && (skippedParamCount > 0 || isParamResolutionError(err))) { return 'params'; }
    return undefined;
}
