import * as assert from 'assert';
import { openDesignDialogOptions, DESIGN_FILE_EXTENSIONS } from '../design_dialog';

suite('design_dialog', () => {
    test('Open Design asks for files only (a files+folders dialog is folder-only on Windows/Linux)', () => {
        const o = openDesignDialogOptions();
        assert.strictEqual(o.canSelectFiles, true);
        assert.strictEqual(o.canSelectFolders, false);
        assert.strictEqual(o.canSelectMany, false);
        assert.deepStrictEqual(DESIGN_FILE_EXTENSIONS, ['uhdm', 'f']);
        const [main] = Object.values(o.filters);
        assert.deepStrictEqual(main, ['uhdm', 'f'], 'the first filter is the design extensions');
        assert.ok(Object.values(o.filters).some(x => x.includes('*')), 'an All files filter stays available');
    });
});
