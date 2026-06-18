import * as assert from 'assert';

import { formatParamValue, isEnumParamType, collectParamOverrides } from '../schematic/param_util';

suite('formatParamValue', () => {
    test('accepts plain ints, sized literals, and strings verbatim', () => {
        assert.strictEqual(formatParamValue(' 8 '), '8');
        assert.strictEqual(formatParamValue("32'd32"), "32'd32");
        assert.strictEqual(formatParamValue("8'hFF"), "8'hFF");
        assert.strictEqual(formatParamValue('"abc"'), '"abc"');
    });
    test('pulls a number out of a simple decorated value', () => {
        assert.strictEqual(formatParamValue('signed (5)'), '5');
        assert.strictEqual(formatParamValue('-5'), '-5');
    });
    test('returns undefined for unparseable values', () => {
        assert.strictEqual(formatParamValue('SomeName'), undefined);
        assert.strictEqual(formatParamValue(''), undefined);
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

    test('keeps non-enum params as -G overrides; no skipped enums', () => {
        const r = collectParamOverrides([p('Width', 'int', '8'), p('ResetAll', 'bit', "1'b0")]);
        assert.deepStrictEqual(r.params, [
            { name: 'Width', verilogLiteral: '8' },
            { name: 'ResetAll', verilogLiteral: "1'b0" },
        ]);
        assert.deepStrictEqual(r.skippedEnums, []);
    });

    test('skips enum params and records name + declaration location (ibex RV32ZC)', () => {
        const r = collectParamOverrides([
            p('RV32ZC', 'Enum rv32zc_e (logic[31:0])', '3', { file: '/x/cd.sv', line: 17, column: 32 }),
            p('Width', 'int', '8'),
        ]);
        assert.deepStrictEqual(r.params, [{ name: 'Width', verilogLiteral: '8' }]);
        assert.deepStrictEqual(r.skippedEnums, [{ name: 'RV32ZC', file: '/x/cd.sv', line: 17, column: 32 }]);
    });

    test('ignores non-parameter items and unparseable values', () => {
        const r = collectParamOverrides([
            { contextValue: 'varItem', type: 'wire', name: 'clk', description: 'logic = x' }, // not a param
            { contextValue: 'scopeItem', type: 'module', name: 'sub' },                       // not a var
            p('Junk', 'string', 'NotANumber'),                                                // unparseable
        ]);
        assert.deepStrictEqual(r, { params: [], skippedEnums: [] });
    });
});
