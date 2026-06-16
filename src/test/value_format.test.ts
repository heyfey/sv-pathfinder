import * as assert from 'assert';

import { formatBusValue } from '../value_format';

suite('formatBusValue', () => {
    test('single bit is returned as-is in every format', () => {
        for (const f of ['hexadecimal', 'decimal', 'binary'] as const) {
            assert.strictEqual(formatBusValue('0', f), '0');
            assert.strictEqual(formatBusValue('1', f), '1');
            assert.strictEqual(formatBusValue('x', f), 'x');
            assert.strictEqual(formatBusValue('z', f), 'z');
        }
    });

    test('hexadecimal: fully-defined bus gets a 0x prefix', () => {
        assert.strictEqual(formatBusValue('00011010', 'hexadecimal'), '0x1a');
        assert.strictEqual(formatBusValue('1111', 'hexadecimal'), '0xf');
        assert.strictEqual(formatBusValue('101', 'hexadecimal'), '0x5');   // width not a multiple of 4
    });

    test('hexadecimal: x/z nibbles render as x/z and drop the 0x prefix', () => {
        assert.strictEqual(formatBusValue('1010xxxx', 'hexadecimal'), 'ax');
        assert.strictEqual(formatBusValue('zzzz', 'hexadecimal'), 'z');
        assert.strictEqual(formatBusValue('xxxxxxxx', 'hexadecimal'), 'xx');
    });

    test('decimal: fully-defined bus → decimal; x/z → falls back to binary', () => {
        assert.strictEqual(formatBusValue('00011010', 'decimal'), '26');
        assert.strictEqual(formatBusValue('1111', 'decimal'), '15');
        assert.strictEqual(formatBusValue('10x1', 'decimal'), '10x1');
    });

    test('decimal handles wide values via BigInt (no precision loss)', () => {
        const bits = '1'.repeat(64);
        assert.strictEqual(formatBusValue(bits, 'decimal'), (2n ** 64n - 1n).toString());
    });

    test('binary returns the raw (lowercased) bit vector', () => {
        assert.strictEqual(formatBusValue('1010', 'binary'), '1010');
        assert.strictEqual(formatBusValue('10X1', 'binary'), '10x1');
    });

    test('non bit-vector input (already formatted / real / string) is left untouched', () => {
        assert.strictEqual(formatBusValue('0x1a', 'decimal'), '0x1a');
        assert.strictEqual(formatBusValue('3.14', 'hexadecimal'), '3.14');
        assert.strictEqual(formatBusValue('', 'hexadecimal'), '');
    });
});
