import * as assert from 'assert';
import {
    NoYosysBackendError,
    isNoYosysBackendError,
    uhdmFrontendUnavailableMessage,
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
        assert.strictEqual(e.name, 'NoYosysBackendError');
    });

    test('uhdmFrontendUnavailableMessage names the runtime and the .f alternative', () => {
        const m = uhdmFrontendUnavailableMessage('schematic runtime (env: /x)');
        assert.ok(m.includes('schematic runtime (env: /x)'));
        assert.ok(m.includes('read_uhdm'));
        assert.ok(m.includes('.f filelist'));
    });
});
