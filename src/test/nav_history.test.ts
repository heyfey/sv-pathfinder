import * as assert from 'assert';

import { isNoOpNavigation, NavContext, findColumnForPath } from '../nav_history';

// Stand-in for a NetlistItem: identity is what matters (reference equality).
type Item = { name: string };

suite('isNoOpNavigation', () => {
    const a: Item = { name: 'tpu.cpu' };
    const b: Item = { name: 'tpu.mem' };

    test('no last context → not a no-op (first navigation is always recorded)', () => {
        assert.strictEqual(isNoOpNavigation(undefined, a, 'gotoDefinition'), false);
    });

    test('same element + same action → no-op (the duplicate-history bug)', () => {
        const last: NavContext<Item> = { element: a, action: 'gotoDefinition' };
        assert.strictEqual(isNoOpNavigation(last, a, 'gotoDefinition'), true);
    });

    test('different element → real jump (recorded)', () => {
        const last: NavContext<Item> = { element: a, action: 'gotoDefinition' };
        assert.strictEqual(isNoOpNavigation(last, b, 'gotoDefinition'), false);
    });

    test('same element but different action → distinct jump (recorded)', () => {
        const last: NavContext<Item> = { element: a, action: 'gotoInstantiation' };
        assert.strictEqual(isNoOpNavigation(last, a, 'gotoDefinition'), false);
    });

    test('equal-by-value but different reference → real jump (identity, not value)', () => {
        const last: NavContext<Item> = { element: { name: 'tpu.cpu' }, action: 'gotoDefinition' };
        assert.strictEqual(isNoOpNavigation(last, { name: 'tpu.cpu' }, 'gotoDefinition'), false);
    });
});

suite('findColumnForPath', () => {
    const groups = [
        { column: 1, paths: ['/a/top.sv', '/a/util.sv'] },
        { column: 2, paths: ['/a/cpu.sv'] },           // a split holding cpu.sv (incl. background tabs)
    ];

    test('file open in a non-active group → returns that group column (the split case)', () => {
        assert.strictEqual(findColumnForPath(groups, '/a/cpu.sv'), 2);
    });

    test('file open in the first group → returns its column', () => {
        assert.strictEqual(findColumnForPath(groups, '/a/util.sv'), 1);
    });

    test('file not open anywhere → undefined (caller opens fresh)', () => {
        assert.strictEqual(findColumnForPath(groups, '/a/mem.sv'), undefined);
    });

    test('no groups → undefined', () => {
        assert.strictEqual(findColumnForPath([], '/a/top.sv'), undefined);
    });
});
