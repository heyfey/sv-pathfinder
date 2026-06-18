// Recover a real module name from a Yosys (uniquified) cell type — vscode-free, unit-tested.
//
// Yosys uniquifies child module names: the slang frontend (read_slang --keep-hierarchy) emits
// `mod$top.path.inst`; a parameterized module is `$paramod\mod\P=V`. This MIRRORS the webview's
// cleanModuleName (src/schematic_webview/main.mjs) — keep the two in sync.
export function cleanCelltype(celltype: string): string {
    if (!celltype) { return celltype; }
    if (celltype.startsWith('$paramod\\')) {
        const parts = celltype.split('\\');
        return parts[1] || celltype;
    }
    const i = celltype.indexOf('$');
    return i > 0 ? celltype.slice(0, i) : celltype;
}
