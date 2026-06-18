// Parameter-override helpers for the schematic's Yosys run (vscode-free so they can be unit-tested).

// Accept plain ints, sized/based literals (8'hFF), and quoted strings; reject anything that doesn't
// look like a Verilog constant so we never inject garbage into a -G/-chparam override.
const VERILOG_LITERAL_RE = /^(\d+|\d*'[bodhBODH][0-9a-fA-FxzXZ_]+|"[^"\\]*")$/;

export function formatParamValue(raw: string): string | undefined {
    const v = raw.trim();
    if (VERILOG_LITERAL_RE.test(v)) { return v; }
    // enum/typedef'd params sometimes print as `name (value)` or similar; try to pull a number
    const m = v.match(/(-?\d+)/);
    if (m) { return m[1]; }
    return undefined;
}

// slang-server reports an enum-typed parameter's type as e.g. "Enum rv32zc_e (logic[31:0])". A bare-
// integer override of such a param fails read_slang's strict typing ("no implicit conversion from
// 'int' to 'rv32zc_e'; explicit conversion exists"), and slang-server gives the enum name WITHOUT its
// package, so we can't build the package-qualified cast (`ibex_pkg::rv32zc_e'(3)`) slang would accept.
// Detect these so the caller skips the override — the module default then applies, which is correct
// whenever the instance's value equals the default (the common case for enum params).
export function isEnumParamType(typePart: string): boolean {
    return /^\s*enum\b/i.test(typePart);
}
