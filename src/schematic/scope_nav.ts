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
