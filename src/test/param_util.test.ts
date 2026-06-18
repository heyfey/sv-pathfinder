import * as assert from 'assert';

import { formatParamValue, isEnumParamType } from '../schematic/param_util';

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
