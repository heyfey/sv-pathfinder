// C3 — Converter: Yosys JSON -> DigitalJS JSON via the published yosys2digitaljs.
// Spike 1 found no cell-coverage patches needed for the validated script presets;
// unknown $-cells throw, so surface a useful error instead of a stack trace.
const { yosys2digitaljs } = require('yosys2digitaljs/core');

export function convertToDigitalJs(yosysJson: any): any {
    try {
        return yosys2digitaljs(yosysJson);
    } catch (e: any) {
        const msg = String(e?.message ?? e);
        const m = msg.match(/Invalid cell type: (.*)/);
        if (m) {
            throw new Error(
                `Schematic converter does not support cell type '${m[1]}'. ` +
                'This is a yosys2digitaljs coverage gap — please report it ' +
                '(see docs/spikes/rtl-structural/cell_coverage.md).');
        }
        throw e;
    }
}
