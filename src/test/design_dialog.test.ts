import * as assert from 'assert';
import { openDesignDialogOptions, DESIGN_EXTENSIONS } from '../design_dialog';

suite('design_dialog', () => {
    test('Open Design asks for files only (a files+folders dialog is folder-only on Windows/Linux)', () => {
        const o = openDesignDialogOptions();
        assert.strictEqual(o.canSelectFiles, true);
        assert.strictEqual(o.canSelectFolders, false);
        assert.strictEqual(o.canSelectMany, false);
    });

    test('the filter lists every design kind the user may know, .daidir included', () => {
        const o = openDesignDialogOptions();
        assert.deepStrictEqual(DESIGN_EXTENSIONS, ['uhdm', 'f', 'daidir']);
        const [label, exts] = Object.entries(o.filters)[0];
        assert.deepStrictEqual(exts, ['uhdm', 'f', 'daidir'], 'the first filter is the design kinds');
        assert.ok(label.includes('.daidir'), label);
        assert.ok(o.title.includes('.daidir'), o.title);
        assert.ok(Object.values(o.filters).some(x => x.includes('*')), 'an All files filter stays available');
    });
});
