import * as assert from 'assert';

import { shouldWarnStaleSource, StaleWarnInput } from '../staleness';

// A baseline "would warn" input; each test overrides one field.
const base: StaleWarnInput = {
    languageId: 'systemverilog',
    suppressed: false,
    hasActiveDesign: true,
    isExample: false,
    alreadyWarned: false,
};

suite('shouldWarnStaleSource', () => {
    test('warns for a systemverilog/verilog save with an active non-example design', () => {
        assert.strictEqual(shouldWarnStaleSource(base), true);
        assert.strictEqual(shouldWarnStaleSource({ ...base, languageId: 'verilog' }), true);
    });

    test('ignores non-HDL languages', () => {
        assert.strictEqual(shouldWarnStaleSource({ ...base, languageId: 'markdown' }), false);
    });

    test('respects the suppress (Don\'t show again) flag', () => {
        assert.strictEqual(shouldWarnStaleSource({ ...base, suppressed: true }), false);
    });

    test('no active design → nothing to be stale', () => {
        assert.strictEqual(shouldWarnStaleSource({ ...base, hasActiveDesign: false }), false);
    });

    test('example designs never warn', () => {
        assert.strictEqual(shouldWarnStaleSource({ ...base, isExample: true }), false);
    });

    test('warns at most once per design until reload', () => {
        assert.strictEqual(shouldWarnStaleSource({ ...base, alreadyWarned: true }), false);
    });
});
