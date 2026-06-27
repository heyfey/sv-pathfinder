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
