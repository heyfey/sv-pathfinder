import * as assert from 'assert';

import { cleanCelltype } from '../schematic/celltype';

suite('cleanCelltype', () => {
    test('strips the slang uniquification suffix (mod$top.path.inst)', () => {
        assert.strictEqual(cleanCelltype('ibex_wb_stage$ibex_core.wb_stage_i'), 'ibex_wb_stage');
        assert.strictEqual(cleanCelltype('ibex_if_stage$ibex_core.if_stage_i'), 'ibex_if_stage');
    });

    test('recovers the module from a $paramod\\mod\\P=V name', () => {
        assert.strictEqual(cleanCelltype('$paramod\\ibex_compressed_decoder\\RV32ZC=3'), 'ibex_compressed_decoder');
    });

    test('leaves a plain (non-uniquified) module name untouched', () => {
        assert.strictEqual(cleanCelltype('ibex_core'), 'ibex_core');
        assert.strictEqual(cleanCelltype(''), '');
    });
});
