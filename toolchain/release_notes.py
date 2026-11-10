#!/usr/bin/env python3
"""Write the GitHub Release notes of one schematic-runtime release from its archives.

    python3 release_notes.py OUT.md ARCHIVE.tar.gz [ARCHIVE.tar.gz ...]

Each archive is a package produced by build-schematic-runtime.sh or repack-oss-cad-suite.sh; its
runtime-manifest.json and the .sha256 file next to it supply everything the notes say: platform, what
the package contains, sizes, SHA-256, and the exact commit of every component. No third-party modules.
"""
import io
import json
import os
import sys
import tarfile

REPOS = {
    "uhdm2rtlil": "https://github.com/alainmarcel/uhdm2rtlil",
    "yosys": "https://github.com/alainmarcel/yosys",
    "yosys-slang": "https://github.com/povik/sv-elab",
    "slang": "https://github.com/MikePopoloski/slang",
    "surelog": "https://github.com/chipsalliance/Surelog",
    "uhdm": "https://github.com/chipsalliance/UHDM",
}
OS_NAMES = {"linux": "Linux", "darwin": "macOS", "win32": "Windows"}


def read_package(tgz):
    manifest, unpacked = None, 0
    with tarfile.open(tgz, "r:gz") as t:
        for m in t:
            unpacked += m.size
            if m.isfile() and m.name.endswith("/runtime-manifest.json") and m.name.count("/") == 1:
                manifest = json.load(io.TextIOWrapper(t.extractfile(m), encoding="utf-8"))
    if manifest is None:
        raise SystemExit(f"{tgz}: no runtime-manifest.json at the package root")
    with open(tgz + ".sha256", encoding="utf-8") as f:
        sha = f.read().split()[0]
    return manifest, sha, os.path.getsize(tgz), unpacked


def commit_cell(component, value):
    if not value or value == "unknown":
        return "unknown"
    repo = REPOS.get(component)
    if repo and len(value) >= 7 and all(c in "0123456789abcdef" for c in value):
        return f"[`{value[:12]}`]({repo}/commit/{value})"
    return f"`{value}`"


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    out, archives = argv[1], argv[2:]
    packages = sorted((read_package(a) + (a,) for a in archives), key=lambda p: (p[0]["os"], p[0]["arch"]))
    version = packages[0][0]["version"]
    lines = [f"Schematic runtime v{version} for sv-pathfinder: the Yosys the schematic view runs on, "
             "downloaded by the extension on the first schematic request. To install by hand, extract one "
             "archive and set `sv-pathfinder.schematicRuntimePath` to the extracted folder.", ""]
    lines += ["| Platform | Frontends | Archive | Compressed | Unpacked | SHA-256 |", "|---|---|---|---|---|---|"]
    for m, sha, size, unpacked, tgz in packages:
        fe = ", ".join(k for k, v in m["features"].items() if v)
        lines.append(f"| {OS_NAMES.get(m['os'], m['os'])} {m['arch']} | {fe} | `{os.path.basename(tgz)}` | "
                     f"{size / 2**20:.1f} MB | {unpacked / 2**20:.0f} MB | `{sha}` |")
    lines.append("")
    for m, sha, size, unpacked, tgz in packages:
        name = f"{OS_NAMES.get(m['os'], m['os'])} {m['arch']}"
        src = m.get("sources", {})
        lines.append(f"### {name}")
        if "oss-cad-suite" in src:
            lines.append(f"Slang-only repack of [OSS CAD Suite]({'https://github.com/YosysHQ/oss-cad-suite-build/releases/tag/' + src['oss-cad-suite']}) "
                         f"release {src['oss-cad-suite']}: Yosys ({m.get('yosysVersion', 'see manifest')}) with the slang plugin, "
                         f"loaded as `yosys -m slang`. No `read_uhdm`: a `.uhdm` design is drawn from its source files on this platform. "
                         f"Built on {m.get('builtOn', '?')}.")
        else:
            lines.append(f"Built from source on {m.get('builtOn', '?')}; runs on glibc {m.get('glibcFloor', '2.28')} or newer "
                         "(RHEL/AlmaLinux 8 and later, any current distribution).")
            lines += ["", "| Component | Commit |", "|---|---|"]
            lines += [f"| {k} | {commit_cell(k, v)} |" for k, v in src.items()]
        lines.append("")
    lines.append("The same pins are in `toolchain/versions.json` at this tag and in `runtime-manifest.json` inside each archive.")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"wrote {out} for {len(packages)} package(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
