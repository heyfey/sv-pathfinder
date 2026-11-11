// vscode-free options of the "Open Design" file dialog, so they can be unit-tested.
//
// Files only: VS Code shows a FOLDER-only dialog on Windows and native Linux when both canSelectFiles
// and canSelectFolders are set, which hid every .f/.uhdm from the user. `.daidir` stays in the filter
// so the user sees it as a design kind, even though a .daidir is a folder (so not selectable here)
// and opening one is not supported yet; the "not yet supported" path in addDesign still answers it.
export const DESIGN_EXTENSIONS = ['uhdm', 'f', 'daidir'];

export function openDesignDialogOptions(): { canSelectFiles: boolean; canSelectFolders: boolean; canSelectMany: boolean; filters: Record<string, string[]>; title: string } {
    return {
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Designs (.uhdm, .f, .daidir)': [...DESIGN_EXTENSIONS], 'All files': ['*'] },
        title: 'Open a design: a .uhdm database, a .f filelist or a .daidir',
    };
}
