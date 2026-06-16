// Decide whether to warn that a design's derived views (hierarchy / schematic / waveform
// annotations) may be out of date because a source file was just saved. vscode-free so it can be
// unit-tested. The caller supplies the observable facts; this is the single source of the policy.

export interface StaleWarnInput {
    languageId: string;       // the saved document's language
    suppressed: boolean;      // user chose "Don't show again"
    hasActiveDesign: boolean; // a design is currently loaded/active
    isExample: boolean;       // example designs are read-only fixtures — never warn
    alreadyWarned: boolean;   // already warned once for the current design (until it's reloaded)
}

export function shouldWarnStaleSource(p: StaleWarnInput): boolean {
    if (p.languageId !== 'verilog' && p.languageId !== 'systemverilog') { return false; }
    if (p.suppressed) { return false; }
    if (!p.hasActiveDesign || p.isExample) { return false; }
    if (p.alreadyWarned) { return false; }
    return true;
}
