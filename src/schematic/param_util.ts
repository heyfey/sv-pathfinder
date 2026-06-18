// Parameter-override helpers for the schematic's Yosys run (vscode-free so they can be unit-tested).

// A single, complete Verilog integer literal: plain int, sized/based literal (8'hFF, 32'd40), or a
// quoted string. Anything else — an unpacked-array literal "[6'b0,...]", a struct "'{...}", a real
// "3.14", or a slang-elided wide constant "160'd172...e9" — is NOT something we can hand to a single
// -G/-chparam override, so it fails this test and the caller leaves the param at its default.
const VERILOG_LITERAL_RE = /^(-?\d+|\d*'[bodhBODH][0-9a-fA-FxzXZ_]+|"[^"\\]*")$/;

export function isCleanVerilogLiteral(value: string): boolean {
    return VERILOG_LITERAL_RE.test(value.trim());
}

// slang-server reports an enum-typed parameter's type as e.g. "Enum rv32zc_e (logic[31:0])". Its value
// prints as a clean int ("3"), so it passes isCleanVerilogLiteral — but a bare-int override of an enum
// param fails read_slang's strict typing ("no implicit conversion from 'int' to 'rv32zc_e'"), and
// slang-server gives the enum name WITHOUT its package, so we can't build the package-qualified cast
// (`ibex_pkg::rv32zc_e'(3)`) slang would accept. So enums need an explicit type-based skip on top of
// the value check; the module default then applies (correct whenever the instance value == default).
export function isEnumParamType(typePart: string): boolean {
    return /^\s*enum\b/i.test(typePart);
}

export interface ParamItem {
    contextValue?: string;
    type?: string;
    description?: unknown;
    name: string;
    sourceFile?: string;
    lineNumber?: number;   // 1-based
    columnNumber?: number; // 1-based
}

// A parameter we could NOT override, with its declaration location (so the warning can point the user
// at it). slang reports the param symbol's location, which is the `parameter … = …;` decl.
export interface SkippedParam {
    name: string;
    file?: string;
    line?: number;   // 1-based
    column?: number; // 1-based
}

export interface CollectedParams {
    params: { name: string; verilogLiteral: string }[]; // -G overrides we can safely apply
    skippedParams: SkippedParam[];                       // params left at their module default (below)
}

// Collect the -G parameter overrides for a scope from its (slang/UHDM) child items. Each parameter
// item's description is "<type> = <value>" (e.g. "bit = 1'b0", "int unsigned = 32'd40",
// "pmp_cfg_t$[0:15] = [6'b0,6'b0,…]", "Enum rv32zc_e (logic[31:0]) = 3").
//
// We WHITELIST what we can faithfully round-trip: a param is overridden only when its value is a clean
// scalar Verilog literal AND its type isn't an enum. Everything else is left at the module default and
// reported in skippedParams (the schematic view warns, naming each + its declaration location).
//
// FINDING / LIMITATION:
// Anything that isn't a plain scalar can't be re-supplied through a single -G override:
//   * Aggregates (unpacked arrays "pmp_cfg_t$[0:15]" / structs) print as a list/brace value that
//     read_slang rejects when assigned a scalar — this is a HARD failure if we try (PMPRstCfg/PMPRstAddr).
//   * Enums need a package-qualified cast we can't build (slang-server drops the package).
//   * Wide constants slang elides for display ("160'd172…e9") can't be parsed back to the real value.
// And we can't even detect when a skipped param's default differs from the instance's value: the
// module default isn't exposed by slang-server or by yosys (write_json omits parameter defaults), and
// we don't parse SystemVerilog ourselves — so the warning is "possibly", not "confirmed". (Exception:
// for a top-level scope the params ARE their defaults, so the caller suppresses the warning there.)
// PROPER FIX (upstream, not near-term): have slang-server's getScope surface round-trippable parameter
// values (package-qualified enum members; non-elided aggregate literals) so we pass them straight to
// -G — then this skip + the warning go away for every parameter type.
//
// UHDM caveat: a UHDM design's parameter description is just "= <value>" (the addon reports the
// resolved value, not the type), so the enum/type checks can't fire for UHDM — an enum param there
// isn't detected and read_slang hard-fails. Matching this handling for UHDM would need the addon
// (GetVars) to also report the parameter's type.
export function collectParamOverrides(items: ParamItem[]): CollectedParams {
    const params: { name: string; verilogLiteral: string }[] = [];
    const skippedParams: SkippedParam[] = [];
    for (const child of items) {
        if (child.contextValue !== 'varItem' || child.type !== 'parameter') { continue; }
        const desc = typeof child.description === 'string' ? child.description : '';
        const eq = desc.lastIndexOf('=');
        if (eq < 0) { continue; } // no resolved value to override — the default already applies
        const typePart = desc.slice(0, eq);
        const value = desc.slice(eq + 1).trim();
        if (isCleanVerilogLiteral(value) && !isEnumParamType(typePart)) {
            params.push({ name: child.name, verilogLiteral: value });
        } else {
            skippedParams.push({ name: child.name, file: child.sourceFile, line: child.lineNumber, column: child.columnNumber });
        }
    }
    return { params, skippedParams };
}
