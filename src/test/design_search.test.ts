import * as assert from 'assert';

import { leafName, toInstanceQuickPickItems, fuzzySubsequenceMatch, filterAndCapInstances, InstanceSearchResult } from '../design_search';

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

suite('fuzzySubsequenceMatch', () => {
    test('matches a contiguous substring and a non-contiguous subsequence', () => {
        assert.strictEqual(fuzzySubsequenceMatch('cpu', 'tb.cpu.alu'), true);   // substring
        assert.strictEqual(fuzzySubsequenceMatch('tbalu', 'tb.cpu.alu'), true); // subsequence (skips)
    });
    test('is case-insensitive', () => {
        assert.strictEqual(fuzzySubsequenceMatch('CPU', 'tb.cpu.alu'), true);
    });
    test('empty query matches anything; order matters', () => {
        assert.strictEqual(fuzzySubsequenceMatch('', 'whatever'), true);
        assert.strictEqual(fuzzySubsequenceMatch('ula', 'tb.cpu.alu'), false); // wrong order
        assert.strictEqual(fuzzySubsequenceMatch('xyz', 'tb.cpu.alu'), false);
    });
});

suite('filterAndCapInstances', () => {
    const all: InstanceSearchResult[] = ['tb.cpu.alu', 'tb.cpu.regfile', 'tb.mem.bank0', 'tb.mem.bank1']
        .map((p) => ({ instPath: p, declName: 'm', file: '/x.sv', line: 1, column: 1 }));

    test('filters by subsequence, counts total, sorts by path', () => {
        const hits = filterAndCapInstances(all, 'cpu', 100);
        assert.strictEqual(hits.total, 2);
        assert.deepStrictEqual(hits.results.map((r) => r.instPath), ['tb.cpu.alu', 'tb.cpu.regfile']);
    });

    test('caps results but reports the true total (for "showing N of M")', () => {
        const hits = filterAndCapInstances(all, 'tb', 2); // all 4 match "tb"
        assert.strictEqual(hits.total, 4);
        assert.strictEqual(hits.results.length, 2);
    });

    test('no matches → empty with zero total', () => {
        assert.deepStrictEqual(filterAndCapInstances(all, 'zzz', 100), { total: 0, results: [] });
    });
});
