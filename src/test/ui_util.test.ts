import * as assert from 'assert';

import { showNoActiveDesignMessage, OPEN_SIDEBAR_ACTION, DESIGNS_VIEW_FOCUS_COMMAND } from '../ui_util';

suite('ui_util', () => {
    test('offers the sidebar action and focuses the Designs view when picked', async () => {
        let shown: { message: string, items: string[] } | undefined;
        const executed: string[] = [];
        await showNoActiveDesignMessage('Open and select a design first.',
            (message, ...items) => { shown = { message, items }; return Promise.resolve(OPEN_SIDEBAR_ACTION); },
            command => { executed.push(command); return Promise.resolve(); });
        assert.strictEqual(shown?.message, 'Open and select a design first.');
        assert.deepStrictEqual(shown?.items, [OPEN_SIDEBAR_ACTION]);
        assert.deepStrictEqual(executed, [DESIGNS_VIEW_FOCUS_COMMAND]);
    });

    test('does not run any command when the message is dismissed', async () => {
        const executed: string[] = [];
        await showNoActiveDesignMessage('Open and select a design first.',
            () => Promise.resolve(undefined),
            command => { executed.push(command); return Promise.resolve(); });
        assert.deepStrictEqual(executed, []);
    });
});
