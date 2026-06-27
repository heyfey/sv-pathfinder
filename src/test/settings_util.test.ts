import * as assert from 'assert';

import { resolveRenamedBool, resolveRenamedString } from '../settings_util';

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

suite('resolveRenamedString (renamed path-prefix back-compat)', () => {
    test('explicit new key wins over the old key', () => {
        // sourcePathFrom set wins over a lingering remotePathPrefix.
        assert.strictEqual(resolveRenamedString('/new', '/old', ''), '/new');
    });

    test('falls back to the old key when the new key is unset', () => {
        assert.strictEqual(resolveRenamedString(undefined, '/old', ''), '/old');
    });

    test('an explicit empty string still counts as set (wins over the old key)', () => {
        // Clearing the new key to "" is a real choice, not "unset" — don't resurrect the old key.
        assert.strictEqual(resolveRenamedString('', '/old', '/def'), '');
    });

    test('uses the default when neither key is set', () => {
        assert.strictEqual(resolveRenamedString(undefined, undefined, ''), '');
    });
});
