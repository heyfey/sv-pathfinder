// Small vscode-free settings helpers (unit-testable).

// Resolve a setting that was renamed: an explicitly-set new key wins, else an explicitly-set old key
// (back-compat for users who configured it before the rename), else the default. Pass the user-set
// values only (not the package.json default) so an unset new key falls through to the old.
export function resolveRenamed<T>(newExplicit: T | undefined, oldExplicit: T | undefined, def: T): T {
    if (newExplicit !== undefined) { return newExplicit; }
    if (oldExplicit !== undefined) { return oldExplicit; }
    return def;
}

export function resolveRenamedBool(
    newExplicit: boolean | undefined,
    oldExplicit: boolean | undefined,
    def: boolean,
): boolean {
    return resolveRenamed(newExplicit, oldExplicit, def);
}

export function resolveRenamedString(
    newExplicit: string | undefined,
    oldExplicit: string | undefined,
    def: string,
): string {
    return resolveRenamed(newExplicit, oldExplicit, def);
}

// Rewrite the first occurrence of `from` in a source path with `to` (the sourcePathFrom/To settings).
// On Windows the match ignores case and treats `\` and `/` as the same separator, because the same
// file arrives as `c:\x\y.sv` from one tool and `C:/x/y.sv` from another; the replaced text keeps
// the rest of the path as it was.
export function remapSourcePath(filePath: string, from: string, to: string, platform: string = process.platform): string {
    if (!from || !to || from === to) { return filePath; }
    if (platform !== 'win32') { return filePath.replace(from, to); }
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const i = norm(filePath).indexOf(norm(from));
    if (i < 0) { return filePath; }
    return filePath.slice(0, i) + to + filePath.slice(i + from.length);
}
