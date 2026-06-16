import * as assert from 'assert';

import { resolveRenamedBool } from '../settings_util';

suite('resolveRenamedBool (renamed setting back-compat)', () => {
    test('explicit new key wins over old key and default', () => {
        assert.strictEqual(resolveRenamedBool(false, true, true), false);
        assert.strictEqual(resolveRenamedBool(true, false, false), true);
    });

    test('falls back to the old key when the new key is unset', () => {
        assert.strictEqual(resolveRenamedBool(undefined, false, true), false);
        assert.strictEqual(resolveRenamedBool(undefined, true, false), true);
    });

    test('uses the default when neither key is set', () => {
        assert.strictEqual(resolveRenamedBool(undefined, undefined, true), true);
        assert.strictEqual(resolveRenamedBool(undefined, undefined, false), false);
    });
});
