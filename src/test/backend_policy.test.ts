import * as assert from 'assert';

import {
    NoYosysBackendError,
    isNoYosysBackendError,
    isLimitedBackend,
    noBackendMessage,
} from '../schematic/backend_policy';

suite('backend_policy', () => {
    test('isNoYosysBackendError: true for the typed error and code tag, false otherwise', () => {
        assert.strictEqual(isNoYosysBackendError(new NoYosysBackendError('x')), true);
        assert.strictEqual(isNoYosysBackendError({ code: 'NO_YOSYS_BACKEND' }), true);
        assert.strictEqual(isNoYosysBackendError(new Error('No usable Yosys')), false);
        assert.strictEqual(isNoYosysBackendError('No usable Yosys'), false);
        assert.strictEqual(isNoYosysBackendError(undefined), false);
    });

    test('NoYosysBackendError carries the message and a stable code', () => {
        const e = new NoYosysBackendError('boom');
        assert.strictEqual(e.message, 'boom');
        assert.strictEqual(e.code, 'NO_YOSYS_BACKEND');
        assert.ok(e instanceof Error);
    });

    test('isLimitedBackend: a non-slang backend is limited', () => {
        assert.strictEqual(isLimitedBackend({ slang: true }), false);
        assert.strictEqual(isLimitedBackend({ slang: false }), true);
        assert.strictEqual(isLimitedBackend(null), false);
        assert.strictEqual(isLimitedBackend(undefined), false);
    });

    test('noBackendMessage mentions the slang-less Yosys only when one was seen', () => {
        assert.ok(!noBackendMessage(false).includes('without the slang frontend'));
        assert.ok(noBackendMessage(true).includes('without the slang frontend'));
        // both always point at the supported fix
        for (const m of [noBackendMessage(false), noBackendMessage(true)]) {
            assert.ok(m.includes('ossCadSuitePath'));
        }
    });
});
