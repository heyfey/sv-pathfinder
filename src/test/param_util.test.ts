import * as assert from 'assert';

import { isCleanVerilogLiteral, isEnumParamType, collectParamOverrides } from '../schematic/param_util';

suite('isCleanVerilogLiteral', () => {
    test('accepts plain ints, sized/based literals, and strings', () => {
        assert.strictEqual(isCleanVerilogLiteral(' 8 '), true);
        assert.strictEqual(isCleanVerilogLiteral("32'd32"), true);
        assert.strictEqual(isCleanVerilogLiteral("8'hFF"), true);
        assert.strictEqual(isCleanVerilogLiteral('-5'), true);
        assert.strictEqual(isCleanVerilogLiteral('"abc"'), true);
    });
    test('rejects aggregates, reals, elided constants, and bare names', () => {
        assert.strictEqual(isCleanVerilogLiteral("[6'b0,6'b0,6'b0]"), false); // unpacked-array value
        assert.strictEqual(isCleanVerilogLiteral("'{a:1,b:2}"), false);        // struct value
        assert.strictEqual(isCleanVerilogLiteral("160'd172472284505947085933645530377016818106...e9"), false); // slang-elided
        assert.strictEqual(isCleanVerilogLiteral('3.14'), false);             // real
        assert.strictEqual(isCleanVerilogLiteral('SomeName'), false);
        assert.strictEqual(isCleanVerilogLiteral(''), false);
    });
});

suite('isEnumParamType', () => {
    test('detects slang enum type strings (the int->enum override hazard)', () => {
        assert.strictEqual(isEnumParamType('Enum rv32zc_e (logic[31:0])'), true);
        assert.strictEqual(isEnumParamType('  enum foo_e (logic[1:0]) '), true);
    });
    test('does not flag plain/builtin parameter types', () => {
        assert.strictEqual(isEnumParamType('int'), false);
        assert.strictEqual(isEnumParamType('bit'), false);
        assert.strictEqual(isEnumParamType('logic[31:0]'), false);
        assert.strictEqual(isEnumParamType('integer'), false); // not "enum", despite containing chars
    });
});

suite('collectParamOverrides', () => {
    const p = (name: string, type: string, value: string, loc?: { file: string; line: number; column: number }) =>
        ({ contextValue: 'varItem', type: 'parameter', name, description: `${type} = ${value}`,
           sourceFile: loc?.file, lineNumber: loc?.line, columnNumber: loc?.column });

    test('keeps clean-scalar params as -G overrides; nothing skipped', () => {
        const r = collectParamOverrides([
            p('Width', 'int unsigned', "32'd8"),
            p('ResetAll', 'bit', "1'b0"),
            p('Seed', 'lfsr_seed_t (aka logic[31:0])', "32'd2891135988"),
        ]);
        assert.deepStrictEqual(r.params, [
            { name: 'Width', verilogLiteral: "32'd8" },
            { name: 'ResetAll', verilogLiteral: "1'b0" },
            { name: 'Seed', verilogLiteral: "32'd2891135988" },
        ]);
        assert.deepStrictEqual(r.skippedParams, []);
    });

    test('skips enum params (clean int value, but int->enum) + records location (ibex RV32ZC)', () => {
        const r = collectParamOverrides([
            p('RV32ZC', 'Enum rv32zc_e (logic[31:0])', '3', { file: '/x/cd.sv', line: 17, column: 32 }),
            p('Width', 'int', '8'),
        ]);
        assert.deepStrictEqual(r.params, [{ name: 'Width', verilogLiteral: '8' }]);
        assert.deepStrictEqual(r.skippedParams, [{ name: 'RV32ZC', file: '/x/cd.sv', line: 17, column: 32 }]);
    });

    test('skips aggregate/elided-valued params (the ibex PMP/LFSR cases)', () => {
        const r = collectParamOverrides([
            p('PMPRstCfg', 'pmp_cfg_t$[0:15]', "[6'b0,6'b0,6'b0]", { file: '/x/core.sv', line: 50, column: 4 }),
            p('PMPRstAddr', 'logic[33:0]$[0:15]', "[34'h0,34'h0]"),
            p('RndCnstLfsrPerm', 'lfsr_perm_t (aka logic[31:0][4:0])', "160'd172472...e9"),
            p('Width', 'int', '8'),
        ]);
        assert.deepStrictEqual(r.params, [{ name: 'Width', verilogLiteral: '8' }]);
        assert.deepStrictEqual(r.skippedParams, [
            { name: 'PMPRstCfg', file: '/x/core.sv', line: 50, column: 4 },
            { name: 'PMPRstAddr', file: undefined, line: undefined, column: undefined },
            { name: 'RndCnstLfsrPerm', file: undefined, line: undefined, column: undefined },
        ]);
    });

    test('ignores non-parameter items and params with no value', () => {
        const r = collectParamOverrides([
            { contextValue: 'varItem', type: 'wire', name: 'clk', description: 'logic' }, // not a param
            { contextValue: 'scopeItem', type: 'module', name: 'sub' },                   // not a var
            { contextValue: 'varItem', type: 'parameter', name: 'NoVal', description: 'int' }, // no '='
        ]);
        assert.deepStrictEqual(r, { params: [], skippedParams: [] });
    });
});
