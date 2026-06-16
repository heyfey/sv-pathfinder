import * as assert from 'assert';

import { isNoOpNavigation, NavContext } from '../nav_history';

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
