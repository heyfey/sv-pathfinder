// vscode-free options of the "Open Design" file dialog, so they can be unit-tested.
//
// Files only: VS Code shows a FOLDER-only dialog on Windows and Linux when both canSelectFiles and
// canSelectFolders are set, which hid every .f/.uhdm from the user. Folder designs (.daidir) are not
// supported yet, so nothing is lost by asking for files only.
export const DESIGN_FILE_EXTENSIONS = ['uhdm', 'f'];

export function openDesignDialogOptions(): { canSelectFiles: boolean; canSelectFolders: boolean; canSelectMany: boolean; filters: Record<string, string[]>; title: string } {
    return {
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Designs (.uhdm, .f)': [...DESIGN_FILE_EXTENSIONS], 'All files': ['*'] },
        title: 'Open a design: a .uhdm database or a .f filelist',
    };
}
