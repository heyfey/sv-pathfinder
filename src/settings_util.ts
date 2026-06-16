// Small vscode-free settings helpers (unit-testable).

// Resolve a boolean setting that was renamed: an explicitly-set new key wins, else an explicitly-set
// old key (back-compat for users who configured it before the rename), else the default. Pass the
// user-set values only (not the package.json default) so an unset new key falls through to the old.
export function resolveRenamedBool(
    newExplicit: boolean | undefined,
    oldExplicit: boolean | undefined,
    def: boolean,
): boolean {
    if (newExplicit !== undefined) { return newExplicit; }
    if (oldExplicit !== undefined) { return oldExplicit; }
    return def;
}
