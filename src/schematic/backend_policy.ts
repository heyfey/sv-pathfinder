// vscode-free policy helpers for the schematic Yosys backend, so they can be unit-tested.
//
// Policy: the schematic wants Yosys + the slang frontend (full SystemVerilog). A plain Yosys without
// slang (Verilog-only read_verilog) is NOT used — its limitations make failures look like our bug.
// The only non-slang fallback is yowasp-yosys (WASM), which is "limited" and must be flagged loudly.

// Thrown when no usable Yosys backend is found. Typed (and code-tagged) so the UI can offer setup
// actions instead of fragile message string-matching.
export class NoYosysBackendError extends Error {
    readonly code = 'NO_YOSYS_BACKEND';
    constructor(message: string) {
        super(message);
        this.name = 'NoYosysBackendError';
    }
}

export function isNoYosysBackendError(e: unknown): boolean {
    if (e instanceof NoYosysBackendError) { return true; }
    return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'NO_YOSYS_BACKEND';
}

// A backend is "limited" when it lacks the slang frontend (i.e. yowasp-yosys) — major SystemVerilog
// gaps; designs may render incompletely or fail to elaborate.
export function isLimitedBackend(b: { slang: boolean } | null | undefined): boolean {
    return !!b && !b.slang;
}

// Message for the "no backend" case. When a plain Yosys was seen on PATH but rejected for lacking
// slang, say so — otherwise the user wonders why their installed yosys "isn't detected".
export function noBackendMessage(sawYosysWithoutSlang: boolean): string {
    const base =
        'No usable Yosys found for the schematic. Install OSS CAD Suite (bundles Yosys + the slang ' +
        'frontend) and set "sv-pathfinder.ossCadSuitePath" for full SystemVerilog support, or ' +
        '`pip install yowasp-yosys` as a limited fallback.';
    if (!sawYosysWithoutSlang) { return base; }
    return base +
        ' (A Yosys without the slang frontend was found but is not used — it supports only limited Verilog.)';
}

// The one-time warning shown when the schematic renders with the limited (yowasp) fallback. Worded
// so the user knows the gaps are the fallback toolchain's, not the design's or this extension's.
export function limitedBackendWarning(backendName: string): string {
    return `Rendering the schematic with ${backendName} — a limited fallback with major SystemVerilog ` +
        `gaps. Some designs render incompletely or fail to elaborate; this is a limitation of the ` +
        `fallback toolchain, not your design or this extension. For full support, install OSS CAD Suite ` +
        `and set "sv-pathfinder.ossCadSuitePath".`;
}
