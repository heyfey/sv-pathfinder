import * as assert from 'assert';

import { resolveRenamedBool, resolveRenamedString, remapSourcePath } from '../settings_util';

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

suite('remapSourcePath (sourcePathFrom/To)', () => {
    test('plain first-occurrence replacement on POSIX', () => {
        assert.strictEqual(remapSourcePath('/srv/db/rtl/a.sv', '/srv/db', '/home/me/db', 'linux'), '/home/me/db/rtl/a.sv');
        assert.strictEqual(remapSourcePath('/other/a.sv', '/srv/db', '/home/me/db', 'linux'), '/other/a.sv');
        assert.strictEqual(remapSourcePath('/srv/db/a.sv', '', '/x', 'linux'), '/srv/db/a.sv', 'empty from = no-op');
        assert.strictEqual(remapSourcePath('/srv/db/a.sv', '/srv/db', '/srv/db', 'linux'), '/srv/db/a.sv', 'from === to = no-op');
    });

    test('Windows: ignores case and separator style in the match, keeps the tail as is', () => {
        assert.strictEqual(remapSourcePath('c:\\Users\\me\\db\\rtl\\a.sv', 'C:/Users/me/db', 'D:\\db', 'win32'), 'D:\\db\\rtl\\a.sv');
        assert.strictEqual(remapSourcePath('/srv/db/rtl/a.sv', '/srv/db', 'C:\\db', 'win32'), 'C:\\db/rtl/a.sv', 'a Linux prefix from a database generated elsewhere');
        assert.strictEqual(remapSourcePath('c:\\elsewhere\\a.sv', 'C:/Users/me/db', 'D:\\db', 'win32'), 'c:\\elsewhere\\a.sv');
    });
});
