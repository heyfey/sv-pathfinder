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

export interface ParamItem {
    contextValue?: string;
    type?: string;
    description?: unknown;
    name: string;
}

export interface CollectedParams {
    params: { name: string; verilogLiteral: string }[]; // -G overrides we can safely apply
    skippedEnums: string[];                              // enum params we couldn't override (see below)
}

// Collect the -G parameter overrides for a scope from its (slang/UHDM) child items. Each parameter
// item's description is "<type> = <value>" (e.g. "Enum rv32zc_e (logic[31:0]) = 3", "int = 8").
//
// FINDING / LIMITATION (enum parameters):
// We CANNOT round-trip an enum parameter override, so we skip it and the module default is drawn —
// which is accurate ONLY when the instance's value equals the module default (the common case). When
// an enum param is overridden to a non-default value the drawing is wrong, and we can't even detect
// that to warn precisely. The reasons, all verified:
//   * read_slang rejects a bare-int override of an enum param (no implicit int->enum).
//   * A valid override needs a package-qualified cast (`ibex_pkg::rv32zc_e'(3)`) or the qualified enum
//     member, but slang-server reports the type WITHOUT the package and the value as the raw int.
//   * The module's *default* value (to compare against the resolved value and confirm inaccuracy)
//     isn't available either: slang-server gives only the resolved value, and yosys's write_json
//     doesn't emit parameter defaults. The only source is the RTL, which is slang's job to read — we
//     don't parse SystemVerilog ourselves.
// PROPER FIX (upstream, not near-term): have slang-server's getScope surface a round-trippable value
// (the package-qualified enum member) so we can pass it straight to -G — then this skip + the warning
// both go away, for every parameter type. Until then the caller surfaces a "possibly inaccurate"
// warning naming the skipped enum params.
export function collectParamOverrides(items: ParamItem[]): CollectedParams {
    const params: { name: string; verilogLiteral: string }[] = [];
    const skippedEnums: string[] = [];
    for (const child of items) {
        if (child.contextValue !== 'varItem' || child.type !== 'parameter') { continue; }
        const desc = typeof child.description === 'string' ? child.description : '';
        const eq = desc.lastIndexOf('=');
        if (eq < 0) { continue; }
        const typePart = desc.slice(0, eq);
        const literal = formatParamValue(desc.slice(eq + 1));
        if (literal === undefined) { continue; } // unparseable value — leave the param at its default
        if (isEnumParamType(typePart)) { skippedEnums.push(child.name); continue; }
        params.push({ name: child.name, verilogLiteral: literal });
    }
    return { params, skippedEnums };
}
