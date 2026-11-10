#!/usr/bin/env python3
"""Print the DLL names a Windows PE file imports (one per line), with no third-party modules.

Used by toolchain/repack-oss-cad-suite.sh on the Windows runner, where neither objdump nor dumpbin
can be relied on, to compute the DLL closure of yosys.exe and the slang plugin.

    python3 pe_imports.py file.exe [file2.dll ...]
"""
import struct
import sys


def imports(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:2] != b'MZ':
        raise ValueError(f'{path}: not a PE file (no MZ header)')
    pe = struct.unpack_from('<I', data, 0x3C)[0]
    if data[pe:pe + 4] != b'PE\0\0':
        raise ValueError(f'{path}: not a PE file (no PE signature)')
    coff = pe + 4
    n_sections, = struct.unpack_from('<H', data, coff + 2)
    opt_size, = struct.unpack_from('<H', data, coff + 16)
    opt = coff + 20
    magic, = struct.unpack_from('<H', data, opt)
    if magic == 0x20B:    # PE32+
        dd = opt + 112
    elif magic == 0x10B:  # PE32
        dd = opt + 96
    else:
        raise ValueError(f'{path}: unknown optional header magic {magic:#x}')
    import_rva, import_size = struct.unpack_from('<II', data, dd + 8)   # data directory [1] = imports
    if import_rva == 0:
        return []
    sections = []
    sec = opt + opt_size
    for i in range(n_sections):
        s = sec + i * 40
        vsize, vaddr, rsize, raw = struct.unpack_from('<IIII', data, s + 8)
        sections.append((vaddr, max(vsize, rsize), raw))

    def rva2off(rva):
        for vaddr, size, raw in sections:
            if vaddr <= rva < vaddr + size:
                return raw + (rva - vaddr)
        raise ValueError(f'{path}: RVA {rva:#x} is in no section')

    names = []
    off = rva2off(import_rva)
    while True:
        _, _, _, name_rva, _ = struct.unpack_from('<IIIII', data, off)
        if name_rva == 0:
            break
        n = rva2off(name_rva)
        end = data.index(b'\0', n)
        names.append(data[n:end].decode('ascii', 'replace'))
        off += 20
    return names


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    seen = set()
    for p in argv[1:]:
        for name in imports(p):
            if name.lower() not in seen:
                seen.add(name.lower())
                print(name)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
