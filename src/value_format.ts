// Format a binary bit-vector value (as VaporView returns it from getValuesAtTime — a string of
// 0/1/x/z) into the user's preferred radix for bus annotations. vscode-free so it can be unit-tested.
//
// Single-bit signals are always returned as-is (0/1/x/z) — a radix prefix on one bit is just noise.
// x/z handling mirrors the schematic: in hex, a nibble containing x/z renders as an x/z digit and the
// "0x" prefix is dropped (the value isn't fully defined); in decimal, any x/z falls back to binary
// (a 4-state value has no decimal).

export type ValueFormat = 'hexadecimal' | 'decimal' | 'binary';

export function formatBusValue(bin: string, format: ValueFormat): string {
    if (typeof bin !== 'string' || bin.length === 0) { return bin; }
    const s = bin.toLowerCase();
    // Leave anything that isn't a plain bit-vector (already-formatted, real numbers, strings) alone.
    if (/[^01xz]/.test(s)) { return bin; }
    if (s.length === 1) { return s; }            // single bit: clearest as 0/1/x/z
    if (format === 'binary') { return s; }
    if (format === 'decimal') {
        if (/[^01]/.test(s)) { return s; }       // contains x/z → no decimal; show the bits
        try { return BigInt('0b' + s).toString(10); } catch { return s; }
    }
    return toHex(s);                              // hexadecimal (default)
}

function toHex(s: string): string {
    const pad = (4 - (s.length % 4)) % 4;
    const p = '0'.repeat(pad) + s;
    let out = '';
    let defined = true;
    for (let i = 0; i < p.length; i += 4) {
        const nib = p.slice(i, i + 4);
        if (/[^01]/.test(nib)) {
            defined = false;
            out += nib.includes('x') ? 'x' : 'z';
        } else {
            out += parseInt(nib, 2).toString(16);
        }
    }
    return defined ? '0x' + out : out;
}
