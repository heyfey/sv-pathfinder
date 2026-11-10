#!/usr/bin/env bash
# Build the sv-pathfinder schematic runtime for Linux x64: one Yosys (static libyosys, read_slang
# built in) plus the uhdm2rtlil plugin (read_uhdm), from the sources pinned in versions.json.
#
# Yosys is built without readline/Tcl (we only ever run `yosys -p`), but WITH ABC: the v0.70 fork's
# slang integration has a build dependency on the yosys-abc target and cannot be configured with
# YOSYS_WITHOUT_ABC=ON. Only bin/yosys is packaged (no yosys-abc); the schematic uses `synth -noabc`.
#
# Reference platform: AlmaLinux 8 + gcc-toolset-14 (scl enable gcc-toolset-14 bash), cmake >= 3.28 (pip),
# python3 >= 3.8 with orderedmultidict, Java >= 11 (Surelog's ANTLR step), bison >= 3.6 (built from
# source on EL8, whose package is 3.0.4), flex, zlib-devel.
# CI runs this inside an almalinux:8 container (.github/workflows/schematic-runtime.yml).
#
# Stages (each is skipped when its output already exists; delete the directory to redo it):
#   1 yosys     clone uhdm2rtlil (pinned tag) and the pinned Yosys fork; build Yosys and install it
#               to <uhdm2rtlil>/out/current (where uhdm2rtlil's plugin build expects it). Build
#               directories are reused only when their recorded source commits match versions.json
#   2 plugin    init uhdm2rtlil's Surelog submodule, build uhdm2rtlil.so against that Yosys through
#               toolchain/cmake/CMakeLists.txt (see there for why a wrapper)
#   3 package   assemble $WORK/package/<name>/ (bin, share/yosys, plugin, LICENSES, manifest), strip
#   4 smoke     run the self-tests on the package and check the glibc floor
#   5 archive   tar.gz + .sha256 in $WORK/dist
#
# Environment: RUNTIME_WORK (default toolchain/work), JOBS (default nproc), RUNTIME_SKIP_SMOKE=1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSIONS="$ROOT/toolchain/versions.json"
WORK="${RUNTIME_WORK:-$ROOT/toolchain/work}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
U2R="$WORK/uhdm2rtlil"
PREFIX="$U2R/out/current"   # uhdm2rtlil's plugin includes headers from here

pin() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval('d'+sys.argv[2]))" "$VERSIONS" "$1"; }
RUNTIME_VERSION="$(pin "['runtimeVersion']")"
YOSYS_REPO="$(pin "['sources']['yosys']['repo']")";       YOSYS_SHA="$(pin "['sources']['yosys']['sha']")"
U2R_REPO="$(pin "['sources']['uhdm2rtlil']['repo']")";    U2R_SHA="$(pin "['sources']['uhdm2rtlil']['sha']")"
SURELOG_SHA="$(pin "['sources']['surelog']['sha']")";      UHDM_SHA="$(pin "['sources']['uhdm']['sha']")"
PKG_NAME="sv-pathfinder-schematic-runtime-linux-x64-$RUNTIME_VERSION"
PKG="$WORK/package/$PKG_NAME"

log() { printf '\n==> %s\n' "$*"; }
gcc_major="$(${CXX:-g++} -dumpversion 2>/dev/null | cut -d. -f1 || echo 0)"
if [ "${gcc_major:-0}" -lt 11 ]; then
  echo "error: need GCC >= 11 (Yosys is C++20); on EL8 run: scl enable gcc-toolset-14 bash" >&2; exit 1
fi
command -v java >/dev/null || { echo "error: java not found (Surelog's ANTLR step needs Java >= 11)" >&2; exit 1; }
# EL8's packages are too old for the Yosys v0.70 fork on two counts; see the workflow for the recipes.
need_version() { # name found minimum hint
  if ! printf '%s\n%s\n' "$3" "${2:-0}" | sort -V -C; then
    echo "error: need $1 >= $3 (found ${2:-none}); $4" >&2; exit 1
  fi
}
need_version CMake "$(cmake --version 2>/dev/null | head -1 | awk '{print $3}')" 3.28 "on EL8 run: python3 -m pip install 'cmake>=3.28'"
need_version Bison "$(bison --version 2>/dev/null | head -1 | awk '{print $NF}')" 3.6 "on EL8 build GNU Bison 3.8.2 from source (ftp.gnu.org/gnu/bison)"
mkdir -p "$WORK"

# Fetch one exact commit (not a branch tip) with a shallow history.
fetch_sha() { # dir repo sha
  local dir="$1" repo="$2" sha="$3"
  if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD)" = "$sha" ]; then return; fi
  rm -rf "$dir"; git init -q "$dir"; git -C "$dir" remote add origin "$repo"
  git -C "$dir" fetch -q --depth 1 origin "$sha"; git -C "$dir" checkout -q FETCH_HEAD
}

# Every derived directory records the source commit(s) it was built from; it is reused only when
# they still match versions.json (fetch_sha re-clones a source tree whose HEAD moved).
built_from() { [ -f "$1/.built-from" ] && [ "$(cat "$1/.built-from")" = "$2" ]; }

# ---- 1 yosys -----------------------------------------------------------------------------------
log "stage 1: sources (uhdm2rtlil @ $U2R_SHA, Yosys fork @ $YOSYS_SHA)"
fetch_sha "$U2R" "$U2R_REPO" "$U2R_SHA"
fetch_sha "$WORK/yosys" "$YOSYS_REPO" "$YOSYS_SHA"
if ! built_from "$WORK/yosys/build" "$YOSYS_SHA"; then
  rm -rf "$WORK/yosys/build" "$PREFIX"
  git -C "$WORK/yosys" submodule update -q --init --recursive --depth 1
  cmake -S "$WORK/yosys" -B "$WORK/yosys/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DBUILD_SHARED_LIBS=OFF \
    -DYOSYS_WITHOUT_READLINE=ON \
    -DYOSYS_WITHOUT_EDITLINE=ON \
    -DYOSYS_WITHOUT_TCL=ON \
    -DYOSYS_WITHOUT_ABC=OFF \
    -DYOSYS_WITHOUT_SLANG=OFF
  cmake --build "$WORK/yosys/build" --parallel "$JOBS"
  echo "$YOSYS_SHA" > "$WORK/yosys/build/.built-from"
else
  log "stage 1: Yosys already built from $YOSYS_SHA"
fi
if ! built_from "$PREFIX" "$YOSYS_SHA"; then
  rm -rf "$PREFIX"
  cmake --install "$WORK/yosys/build" --prefix "$PREFIX"
  echo "$YOSYS_SHA" > "$PREFIX/.built-from"
fi
"$PREFIX/bin/yosys" -V

# ---- 2 plugin ----------------------------------------------------------------------------------
PLUGIN_BUILD="$WORK/plugin-build"
PLUGIN_PINS="$U2R_SHA $YOSYS_SHA $SURELOG_SHA $UHDM_SHA"
PLUGIN="$(find "$PLUGIN_BUILD" -name 'uhdm2rtlil.so' 2>/dev/null | head -1 || true)"
if [ -z "$PLUGIN" ] || ! built_from "$PLUGIN_BUILD" "$PLUGIN_PINS"; then
  rm -rf "$PLUGIN_BUILD"
  log "stage 2: uhdm2rtlil plugin (Surelog $SURELOG_SHA, UHDM $UHDM_SHA)"
  # Only Surelog (and its UHDM, antlr, capnproto) is needed; third_party/yosys is replaced by $PREFIX.
  git -C "$U2R" submodule update -q --init --recursive --depth 1 third_party/Surelog
  got_surelog="$(git -C "$U2R/third_party/Surelog" rev-parse HEAD)"
  got_uhdm="$(git -C "$U2R/third_party/Surelog/third_party/UHDM" rev-parse HEAD)"
  [ "$got_surelog" = "$SURELOG_SHA" ] || { echo "error: Surelog submodule is $got_surelog, versions.json says $SURELOG_SHA" >&2; exit 1; }
  [ "$got_uhdm" = "$UHDM_SHA" ] || { echo "error: UHDM submodule is $got_uhdm, versions.json says $UHDM_SHA" >&2; exit 1; }
  cmake -S "$ROOT/toolchain/cmake" -B "$PLUGIN_BUILD" \
    -DCMAKE_BUILD_TYPE=Release \
    -DUHDM2RTLIL_SOURCE_DIR="$U2R" \
    -DSURELOG_WITH_TCMALLOC=OFF \
    -DSURELOG_BUILD_TESTS=OFF \
    -DUHDM_BUILD_TESTS=OFF
  cmake --build "$PLUGIN_BUILD" --parallel "$JOBS" --target uhdm2rtlil
  PLUGIN="$(find "$PLUGIN_BUILD" -name 'uhdm2rtlil.so' | head -1)"
  [ -n "$PLUGIN" ] || { echo "error: uhdm2rtlil.so not produced" >&2; exit 1; }
  echo "$PLUGIN_PINS" > "$PLUGIN_BUILD/.built-from"
else
  log "stage 2: plugin already built from the pinned sources: $PLUGIN"
fi

# ---- 3 package ---------------------------------------------------------------------------------
log "stage 3: package $PKG"
rm -rf "$PKG"; mkdir -p "$PKG/bin" "$PKG/share/yosys/plugins" "$PKG/LICENSES"
cp "$PREFIX/bin/yosys" "$PKG/bin/yosys"
# share/yosys: cell libraries and techmaps that passes read at run time; headers are build-time only.
cp -a "$PREFIX/share/yosys/." "$PKG/share/yosys/"
rm -rf "$PKG/share/yosys/include" "$PKG/share/yosys/python3" "$PKG/share/yosys/plugins"
mkdir -p "$PKG/share/yosys/plugins"
cp "$PLUGIN" "$PKG/share/yosys/plugins/uhdm2rtlil.so"
strip --strip-unneeded "$PKG/bin/yosys" "$PKG/share/yosys/plugins/uhdm2rtlil.so"
lic() { # src-file dest-name
  if [ -f "$1" ]; then cp "$1" "$PKG/LICENSES/$2"; else echo "warning: license file missing: $1" >&2; fi
}
Y="$WORK/yosys"; S="$U2R/third_party/Surelog"
lic "$Y/COPYING"                                   yosys.COPYING
lic "$Y/libs/slang/LICENSE"                        slang.LICENSE
lic "$Y/libs/fmt/LICENSE"                          fmt.LICENSE
lic "$Y/libs/cxxopts/LICENSE"                      cxxopts.LICENSE
lic "$Y/libs/tomlplusplus/LICENSE"                 tomlplusplus.LICENSE
lic "$Y/libs/boost_regex/LICENSE"                  boost_regex.LICENSE
lic "$U2R/LICENSE"                                 uhdm2rtlil.LICENSE
lic "$S/LICENSE"                                   surelog.LICENSE
lic "$S/third_party/UHDM/LICENSE"                  uhdm.LICENSE
lic "$S/third_party/UHDM/third_party/capnproto/LICENSE" capnproto.LICENSE
lic "$S/third_party/antlr4/LICENSE.txt"            antlr4.LICENSE
# The slang frontend and the slang library are submodules of the pinned Yosys; record their exact
# commits too, so a release says what it contains without a lookup in the Yosys fork.
YOSYS_SLANG_SHA="$(git -C "$Y" rev-parse HEAD:frontends/slang/lib 2>/dev/null || echo unknown)"
SLANG_SHA="$(git -C "$Y" rev-parse HEAD:libs/slang 2>/dev/null || echo unknown)"
python3 - "$PKG/runtime-manifest.json" "$RUNTIME_VERSION" "$U2R_SHA" "$YOSYS_SHA" "$SURELOG_SHA" "$UHDM_SHA" "$YOSYS_SLANG_SHA" "$SLANG_SHA" <<'PY'
import json, sys, subprocess, datetime
out, ver, u2r, yosys, surelog, uhdm, yosys_slang, slang = sys.argv[1:]
json.dump({
  "schema": 1, "version": ver, "os": "linux", "arch": "x64", "glibcFloor": "2.28",
  "features": {"read_slang": True, "read_uhdm": True},
  "sources": {"uhdm2rtlil": u2r, "yosys": yosys, "yosys-slang": yosys_slang, "slang": slang, "surelog": surelog, "uhdm": uhdm},
  "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "builtOn": subprocess.run(["bash", "-c", ". /etc/os-release && echo $PRETTY_NAME"], capture_output=True, text=True).stdout.strip(),
}, open(out, "w"), indent=2)
PY
du -sh "$PKG" "$PKG/bin/yosys" "$PKG/share/yosys/plugins/uhdm2rtlil.so"

# ---- 4 smoke -----------------------------------------------------------------------------------
if [ "${RUNTIME_SKIP_SMOKE:-0}" != "1" ]; then
  log "stage 4: smoke tests"
  if strings "$PKG/bin/yosys" "$PKG/share/yosys/plugins/uhdm2rtlil.so" | grep -E "^$WORK|^/home/" | head -3 | grep .; then
    echo "warning: build-machine paths embedded in the binaries (see above)" >&2
  fi
  for f in "$PKG/bin/yosys" "$PKG/share/yosys/plugins/uhdm2rtlil.so"; do
    echo "-- ldd $f"; ldd "$f" | awk '{print "   " $1}'
    max="$(objdump -T "$f" | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -1)"
    echo "   highest glibc symbol: $max"
    [ "$(printf '%s\n' "$max" GLIBC_2.28 | sort -V | tail -1)" = GLIBC_2.28 ] || { echo "error: $f needs $max > GLIBC_2.28" >&2; exit 1; }
  done
  "$PKG/bin/yosys" -q -p 'help read_slang' | head -3
  "$PKG/bin/yosys" -q -m uhdm2rtlil -p 'help read_uhdm' | head -3
  tmp="$(mktemp -d)"
  cat > "$tmp/t.sv" <<'SV'
module t(input logic clk, input logic [3:0] a, output logic [3:0] q);
  always_ff @(posedge clk) q <= a + 4'd1;
endmodule
SV
  "$PKG/bin/yosys" -q -p "read_slang $tmp/t.sv; hierarchy -top t; proc; opt_clean; write_json $tmp/slang.json" >/dev/null
  grep -q '"t"' "$tmp/slang.json" && echo "   read_slang -> write_json OK"
  "$PKG/bin/yosys" -q -p "read_slang $tmp/t.sv; hierarchy -top t; synth -top t -noabc; write_json $tmp/gls.json" >/dev/null
  grep -q '"t"' "$tmp/gls.json" && echo "   synth -noabc OK"
  rm -rf "$tmp"
fi

# ---- 5 archive ---------------------------------------------------------------------------------
log "stage 5: archive"
mkdir -p "$WORK/dist"
tar -C "$WORK/package" -czf "$WORK/dist/$PKG_NAME.tar.gz" "$PKG_NAME"
( cd "$WORK/dist" && sha256sum "$PKG_NAME.tar.gz" > "$PKG_NAME.tar.gz.sha256" && cat "$PKG_NAME.tar.gz.sha256" )
ls -la "$WORK/dist/$PKG_NAME.tar.gz"

# Release notes (outside dist/, which holds only the downloadable assets): what the archive contains
# and the exact commit of every component, taken from the package manifest.
python3 - "$PKG/runtime-manifest.json" "$WORK/release-notes.md" "$WORK/dist/$PKG_NAME.tar.gz" <<'PY'
import json, os, sys
m = json.load(open(sys.argv[1])); tgz = sys.argv[3]
sha = open(tgz + ".sha256").read().split()[0]
unpacked = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(os.path.dirname(sys.argv[1])) for f in fs)
pins = {"uhdm2rtlil": "https://github.com/alainmarcel/uhdm2rtlil", "yosys": "https://github.com/alainmarcel/yosys",
        "yosys-slang": "https://github.com/povik/sv-elab", "slang": "https://github.com/MikePopoloski/slang",
        "surelog": "https://github.com/chipsalliance/Surelog", "uhdm": "https://github.com/chipsalliance/UHDM"}
rows = "\n".join(f"| {k} | [`{v[:12]}`]({pins[k]}/commit/{v}) |" if v != "unknown" else f"| {k} | unknown |"
                  for k, v in m["sources"].items())
open(sys.argv[2], "w").write(f"""Schematic runtime v{m['version']} for sv-pathfinder: Yosys with the `read_slang` and `read_uhdm` frontends.

- Platform: Linux x64, built on {m['builtOn']}, runs on glibc {m['glibcFloor']} or newer (RHEL/AlmaLinux 8 and later, any current distribution).
- Archive: `{os.path.basename(tgz)}`, {os.path.getsize(tgz) / 2**20:.1f} MB compressed, {unpacked / 2**20:.0f} MB unpacked.
- SHA-256: `{sha}`

The extension downloads this archive on the first schematic request. To install by hand, extract it and set `sv-pathfinder.schematicRuntimePath` to the extracted folder.

| Component | Commit |
|---|---|
{rows}

The same pins are in `toolchain/versions.json` at this tag and in `runtime-manifest.json` inside the archive.
""")
PY
echo "done: $WORK/dist/$PKG_NAME.tar.gz (release notes: $WORK/release-notes.md)"
