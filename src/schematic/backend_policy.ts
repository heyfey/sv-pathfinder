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

// How a directly opened .uhdm design is elaborated (setting sv-pathfinder.schematicUhdmFrontend):
//  'auto'       try read_uhdm (experimental importer); on any failure fall back to read_slang over the
//               design's source files (the behavior before read_uhdm existed);
//  'read_uhdm'  read_uhdm only, surface its errors;
//  'read_slang' never import the database, re-parse the sources (works on every platform).
export type UhdmFrontendMode = 'auto' | 'read_uhdm' | 'read_slang';
export function uhdmFrontendMode(setting: unknown): UhdmFrontendMode {
    return setting === 'read_uhdm' || setting === 'read_slang' ? setting : 'auto';
}

// The one-time note when 'auto' falls back. The first error line is enough to point at the cause.
export function uhdmFallbackWarning(designName: string, firstErrorLine: string): string {
    return `Schematic: read_uhdm (experimental) could not import '${designName}' — falling back to re-parsing ` +
        `its source files with read_slang (defines/includes the database had are not available there). ` +
        `Importer error: ${firstErrorLine.trim() || 'see the "sv-pathfinder" output'}`;
}

// Message for a Yosys process that ended abnormally. `signal` is set when the OS killed it (a crash in
// Yosys or the plugin, or the OOM killer); `code` otherwise.
export function yosysExitMessage(backendName: string, code: number | null, signal: string | null, usingUhdm: boolean): string {
    if (signal) {
        return `Yosys (${backendName}) was terminated by ${signal}` +
            (usingUhdm ? ' while importing the .uhdm database — most likely a crash in the uhdm2rtlil importer ' +
                '(please report it upstream with the database), or the machine ran out of memory.'
                : ' — most likely a crash or the machine ran out of memory.');
    }
    return `Yosys (${backendName}) failed with code ${code ?? -1}:`;
}

// A direct .uhdm design needs the read_uhdm frontend, which only the Linux x64 runtime has.
export function uhdmFrontendUnavailableMessage(runtimeName: string): string {
    return `This design is a .uhdm database, which the schematic reads with the read_uhdm frontend; ` +
        `the active runtime (${runtimeName}) does not provide it. On Linux x64 the managed runtime does; ` +
        'elsewhere, open the design from its .f filelist to use read_slang instead.';
}
