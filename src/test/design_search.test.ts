import * as assert from 'assert';

import { leafName, toInstanceQuickPickItems, InstanceSearchResult } from '../design_search';

function res(instPath: string, declName = 'mod'): InstanceSearchResult {
    return { instPath, declName, file: '/x.sv', line: 1, column: 1 };
}

suite('leafName', () => {
    test('returns the last path segment', () => {
        assert.strictEqual(leafName('tb.u_fifo.cell'), 'cell');
        assert.strictEqual(leafName('top'), 'top');
    });
    test('preserves a generate/array index on the leaf', () => {
        assert.strictEqual(leafName('tb.gen_blk[3].u'), 'u');
        assert.strictEqual(leafName('tb.banks[2]'), 'banks[2]');
    });
});

suite('toInstanceQuickPickItems', () => {
    test('label is the leaf, detail is the full path, description is the module', () => {
        const [it] = toInstanceQuickPickItems([res('tb.u_fifo.cell', 'fifo_cell')]);
        assert.strictEqual(it.label, 'cell');
        assert.strictEqual(it.detail, 'tb.u_fifo.cell');
        assert.strictEqual(it.description, 'fifo_cell');
        assert.strictEqual(it.result.instPath, 'tb.u_fifo.cell');
    });

    test('items are sorted by full path (stable order before fuzzy ranking)', () => {
        const items = toInstanceQuickPickItems([res('tb.b'), res('tb.a'), res('tb.a.x')]);
        assert.deepStrictEqual(items.map((i) => i.detail), ['tb.a', 'tb.a.x', 'tb.b']);
    });

    test('empty input → empty list', () => {
        assert.deepStrictEqual(toInstanceQuickPickItems([]), []);
    });
});
