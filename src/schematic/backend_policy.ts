// vscode-free policy helpers for the schematic Yosys backend, so they can be unit-tested.
//
// Policy: the schematic runs on the managed schematic runtime (Yosys with read_slang built in plus the
// uhdm2rtlil plugin for read_uhdm), installed on first use, or on a directory the user points at via
// the `schematicRuntimePath` setting / SV_PATHFINDER_SCHEMATIC_RUNTIME. No PATH probing, no
// Verilog-only fallback: a plain Yosys without slang would make failures look like our bug.

// Thrown when no usable runtime is available (not installed, declined, unsupported platform, or a
// bad override). Typed (and code-tagged) so the UI can offer setup actions instead of fragile
// message string-matching.
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

// A direct .uhdm design needs the read_uhdm frontend, which only the Linux x64 runtime has.
export function uhdmFrontendUnavailableMessage(runtimeName: string): string {
    return `This design is a .uhdm database, which the schematic reads with the read_uhdm frontend; ` +
        `the active runtime (${runtimeName}) does not provide it. On Linux x64 the managed runtime does; ` +
        'elsewhere, open the design from its .f filelist to use read_slang instead.';
}
