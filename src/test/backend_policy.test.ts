import * as assert from 'assert';
import {
    NoYosysBackendError,
    isNoYosysBackendError,
    uhdmFrontendUnavailableMessage,
    uhdmFrontendMode,
    uhdmFallbackWarning,
    yosysExitMessage,
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

    test('uhdmFrontendMode: only the two explicit values are honoured, anything else is auto', () => {
        assert.strictEqual(uhdmFrontendMode('read_uhdm'), 'read_uhdm');
        assert.strictEqual(uhdmFrontendMode('read_slang'), 'read_slang');
        assert.strictEqual(uhdmFrontendMode('auto'), 'auto');
        assert.strictEqual(uhdmFrontendMode(undefined), 'auto');
        assert.strictEqual(uhdmFrontendMode('bogus'), 'auto');
    });

    test('uhdmFallbackWarning names the design, the fallback and the importer error', () => {
        const m = uhdmFallbackWarning('surelog.uhdm', "ERROR: Could not find wire 'fifo_rf_r' for bit select");
        assert.ok(m.includes('surelog.uhdm') && m.includes('read_slang') && m.includes('fifo_rf_r'));
        assert.ok(uhdmFallbackWarning('x.uhdm', '   ').includes('see the "sv-pathfinder" output'));
    });

    test('yosysExitMessage: a signal death is reported as a crash, a .uhdm run points at the importer', () => {
        assert.ok(yosysExitMessage('rt', null, 'SIGSEGV', true).includes('terminated by SIGSEGV'));
        assert.ok(yosysExitMessage('rt', null, 'SIGSEGV', true).includes('uhdm2rtlil importer'));
        assert.ok(!yosysExitMessage('rt', null, 'SIGKILL', false).includes('uhdm2rtlil'));
        assert.strictEqual(yosysExitMessage('rt', 1, null, false), 'Yosys (rt) failed with code 1:');
        assert.strictEqual(yosysExitMessage('rt', null, null, false), 'Yosys (rt) failed with code -1:');
    });

    test('uhdmFrontendUnavailableMessage names the runtime and the .f alternative', () => {
        const m = uhdmFrontendUnavailableMessage('schematic runtime (env: /x)');
        assert.ok(m.includes('schematic runtime (env: /x)'));
        assert.ok(m.includes('read_uhdm'));
        assert.ok(m.includes('.f filelist'));
    });
});
