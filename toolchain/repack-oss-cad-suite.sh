#!/usr/bin/env bash
# Repack a pinned OSS CAD Suite release into a slang-only sv-pathfinder schematic runtime for the
# platforms we do not build ourselves (macOS, Windows): Yosys + the slang plugin (read_slang), their
# library closure, share/yosys, licenses and a runtime-manifest.json with `features.read_uhdm: false`
# and `preload: ["slang"]` (the extension then runs `yosys -m slang`).
#
#   toolchain/repack-oss-cad-suite.sh <platform-key>      # darwin-arm64 | darwin-x64 | win32-x64 | linux-x64
#
# The pin (release tag + per-platform archive name and SHA-256) is `sources.ossCadSuite` in
# toolchain/versions.json. linux-x64 is accepted only to test this script on a Linux box; the Linux
# runtime users get is built from source by build-schematic-runtime.sh.
#
# Stages: 1 fetch (download + SHA-256), 2 extract, 3 package (closure by otool / objdump /
# pe_imports.py), 4 smoke (read_slang on a tiny module on this machine), 5 archive (tar.gz + .sha256
# in $WORK/dist). Runs on macOS (bash 3.2 + bsdtar), Windows Git Bash and Linux.
#
# Environment: RUNTIME_WORK (default toolchain/work-osscad), RUNTIME_SKIP_SMOKE=1.
set -euo pipefail

KEY="${1:-}"
case "$KEY" in
  darwin-arm64|darwin-x64|win32-x64|linux-x64) ;;
  *) echo "usage: $0 darwin-arm64|darwin-x64|win32-x64|linux-x64" >&2; exit 2 ;;
esac
OS="${KEY%-*}"; ARCH="${KEY#*-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSIONS="$ROOT/toolchain/versions.json"
WORK="${RUNTIME_WORK:-$ROOT/toolchain/work-osscad}/$KEY"
PY="$(command -v python3 || command -v python)"
pin() { "$PY" -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval('d'+sys.argv[2]))" "$VERSIONS" "$1"; }
RUNTIME_VERSION="$(pin "['runtimeVersion']")"
RELEASE="$(pin "['sources']['ossCadSuite']['release']")"
SUITE_NAME="$(pin "['sources']['ossCadSuite']['assets']['$KEY']['name']")"
SUITE_SHA="$(pin "['sources']['ossCadSuite']['assets']['$KEY']['sha256']")"
SUITE_URL="https://github.com/YosysHQ/oss-cad-suite-build/releases/download/$RELEASE/$SUITE_NAME"
PKG_NAME="sv-pathfinder-schematic-runtime-$KEY-$RUNTIME_VERSION"
PKG="$WORK/package/$PKG_NAME"
EXE="yosys"; [ "$OS" = win32 ] && EXE="yosys.exe"

log() { printf '\n==> %s\n' "$*"; }
sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mkdir -p "$WORK"

# ---- 1 fetch -----------------------------------------------------------------------------------
log "stage 1: OSS CAD Suite $RELEASE / $SUITE_NAME"
SUITE_TGZ="$WORK/$SUITE_NAME"
if [ ! -f "$SUITE_TGZ" ] || [ "$(sha256_of "$SUITE_TGZ")" != "$SUITE_SHA" ]; then
  curl -sSfL -o "$SUITE_TGZ" "$SUITE_URL"
fi
got="$(sha256_of "$SUITE_TGZ")"
[ "$got" = "$SUITE_SHA" ] || { echo "error: $SUITE_NAME sha256 $got != pinned $SUITE_SHA" >&2; exit 1; }

# ---- 2 extract ---------------------------------------------------------------------------------
SUITE="$WORK/suite/oss-cad-suite"
if [ ! -f "$SUITE/.extracted-from" ] || [ "$(cat "$SUITE/.extracted-from")" != "$SUITE_SHA" ]; then
  log "stage 2: extract (this is the whole suite, several hundred MB)"
  rm -rf "$WORK/suite"; mkdir -p "$WORK/suite"
  tar -C "$WORK/suite" -xzf "$SUITE_TGZ"
  echo "$SUITE_SHA" > "$SUITE/.extracted-from"
fi
[ -f "$SUITE/VERSION" ] || { echo "error: $SUITE/VERSION missing after extraction" >&2; exit 1; }

# ---- 3 package ---------------------------------------------------------------------------------
log "stage 3: package $PKG_NAME"
rm -rf "$PKG"; mkdir -p "$PKG/bin" "$PKG/share/yosys/plugins" "$PKG/LICENSES"

# Find a library of the suite by file name (lib/, then bin/, then libexec/).
find_lib() { for d in lib bin libexec; do [ -f "$SUITE/$d/$1" ] && { echo "$SUITE/$d/$1"; return; }; done; return 1; }

# Direct dependencies of one binary, as bare file names, system libraries excluded.
deps_of() {
  case "$OS" in
    darwin)
      otool -L "$1" | tail -n +2 | awk '{print $1}' | grep -v '^/usr/lib/\|^/System/' | sed 's#.*/##' ;;
    win32)
      "$PY" "$ROOT/toolchain/pe_imports.py" "$1" | grep -vi \
        '^\(kernel32\|msvcrt\|advapi32\|user32\|ws2_32\|shell32\|ole32\|oleaut32\|netapi32\|userenv\|iphlpapi\|bcrypt\|crypt32\|gdi32\|comdlg32\|rpcrt4\|ucrtbase\|api-ms-win\|yosys\.exe\)' || true ;;
    linux)
      objdump -p "$1" | awk '/NEEDED/{print $2}' ;;
  esac
}

# Copy a library and, recursively, what it needs. Symlinks are resolved (cp -L): the archive must
# contain plain files only (the extension's extractor rejects links).
copied=""
copy_closure() { # file destdir
  local f="$1" dest="$2" d src self
  self="$(basename "$f")"
  for d in $(deps_of "$f"); do
    [ "$d" = "$self" ] && continue   # otool -L lists a library's own install name first
    case " $copied " in *" $d "*) continue;; esac
    copied="$copied $d"
    src="$(find_lib "$d")" || { echo "error: $(basename "$f") needs $d, not found in the suite" >&2; exit 1; }
    cp -L "$src" "$dest/$d"
    copy_closure "$src" "$dest"
  done
}

case "$OS" in
  darwin|linux)
    # bin/yosys is the suite's launcher (sets PATH, exec's libexec/yosys); keep it and what it calls.
    cp -L "$SUITE/bin/yosys" "$PKG/bin/yosys"
    mkdir -p "$PKG/libexec" "$PKG/lib"
    cp -L "$SUITE/libexec/yosys" "$PKG/libexec/yosys"
    [ -f "$SUITE/libexec/realpath" ] && cp -L "$SUITE/libexec/realpath" "$PKG/libexec/realpath"
    if [ "$OS" = linux ]; then cp -L "$SUITE/lib/ld-linux-x86-64.so.2" "$PKG/lib/"; fi
    copy_closure "$PKG/libexec/yosys" "$PKG/lib"
    ;;
  win32)
    # yosys.exe finds DLLs next to itself first, so the closure goes into bin/ and no launcher is needed.
    cp -L "$SUITE/bin/yosys.exe" "$PKG/bin/yosys.exe"
    copy_closure "$PKG/bin/yosys.exe" "$PKG/bin"
    ;;
esac
cp -L "$SUITE/share/yosys/plugins/slang.so" "$PKG/share/yosys/plugins/slang.so"
case "$OS" in darwin|linux) copy_closure "$PKG/share/yosys/plugins/slang.so" "$PKG/lib" ;; win32) copy_closure "$PKG/share/yosys/plugins/slang.so" "$PKG/bin" ;; esac
chmod -R u+rwX,go+rX "$PKG"

# share/yosys: the techmap/simlib files every pass may need, minus headers, Python and other plugins.
( cd "$SUITE/share/yosys" && tar -cf - --exclude=./include --exclude=./python3 --exclude=./plugins . ) | ( cd "$PKG/share/yosys" && tar -xf - )

# Licenses: the suite's texts for what we ship, plus a notice that names the bundled libraries.
for l in LICENSE.yosys LICENSE.yosys-slang-plugin; do
  [ -f "$SUITE/license/$l" ] && cp -L "$SUITE/license/$l" "$PKG/LICENSES/$l"
done
libs_list="$(ls "$PKG/lib" 2>/dev/null | tr '\n' ' ' || true)$(cd "$PKG/bin" && ls | grep -i '\.dll$' | tr '\n' ' ' || true)"
cat > "$PKG/LICENSES/NOTICE.txt" <<EOF
This runtime is a subset of OSS CAD Suite release $RELEASE ($SUITE_NAME), built and
distributed by YosysHQ: https://github.com/YosysHQ/oss-cad-suite-build

Contents: Yosys (ISC, LICENSE.yosys), the yosys-slang plugin (ISC, LICENSE.yosys-slang-plugin) with the
slang SystemVerilog library (MIT), and the shared libraries Yosys links against as shipped by the
suite: $libs_list
(GNU Readline is GPL-3.0; libstdc++/libgcc are GPL-3.0 with the GCC Runtime Library Exception; zlib,
libffi, Tcl and the MinGW runtime under their respective permissive licenses). The build recipes and
the source of every component are in the oss-cad-suite-build repository at tag $RELEASE.
EOF

# Manifest. `yosys -V` names the Yosys commit; the plugin has no version query, so the suite release
# date pins it.
YOSYS_V="$("$PKG/bin/$EXE" -V 2>/dev/null | head -1 || true)"
YOSYS_SHA="$(printf '%s' "$YOSYS_V" | sed -n 's/.*git sha1 \([0-9a-f]*\).*/\1/p')"
BUILT_ON="$(case "$OS" in darwin) sw_vers -productName 2>/dev/null | tr -d '\n'; printf ' '; sw_vers -productVersion 2>/dev/null;; win32) printf 'Windows %s' "$(uname -r 2>/dev/null)";; *) . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME";; esac)"
"$PY" - "$PKG/runtime-manifest.json" "$RUNTIME_VERSION" "$OS" "$ARCH" "$RELEASE" "${YOSYS_SHA:-unknown}" "$YOSYS_V" "$BUILT_ON" <<'PY'
import json, sys, datetime
out, ver, os_, arch, release, ysha, yv, built_on = sys.argv[1:]
json.dump({
  "schema": 1, "version": ver, "os": os_, "arch": arch,
  "features": {"read_slang": True, "read_uhdm": False},
  "preload": ["slang"],
  "sources": {"oss-cad-suite": release, "yosys": ysha},
  "yosysVersion": yv,
  "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "builtOn": built_on.strip(),
}, open(out, "w"), indent=2)
PY
du -sh "$PKG" "$PKG/bin/$EXE" "$PKG/share/yosys/plugins/slang.so"

# ---- 4 smoke -----------------------------------------------------------------------------------
if [ -z "${RUNTIME_SKIP_SMOKE:-}" ]; then
  log "stage 4: smoke (read_slang on this machine)"
  SMOKE="$WORK/smoke"; rm -rf "$SMOKE"; mkdir -p "$SMOKE"
  printf 'module t(input a, b, output y); assign y = a & b; endmodule\n' > "$SMOKE/t.sv"
  ( cd "$SMOKE" && "$PKG/bin/$EXE" -q -m slang -p 'read_slang t.sv --top t; hierarchy -top t; proc; write_json t.json' )
  grep -q '"t"' "$SMOKE/t.json" || { echo "error: smoke write_json has no module t" >&2; exit 1; }
  echo "$YOSYS_V"
  echo "smoke OK"
fi

# ---- 5 archive ---------------------------------------------------------------------------------
log "stage 5: archive"
mkdir -p "$WORK/dist"
COPYFILE_DISABLE=1 tar -C "$WORK/package" --dereference -czf "$WORK/dist/$PKG_NAME.tar.gz" "$PKG_NAME"
( cd "$WORK/dist" && printf '%s  %s\n' "$(sha256_of "$PKG_NAME.tar.gz")" "$PKG_NAME.tar.gz" > "$PKG_NAME.tar.gz.sha256" && cat "$PKG_NAME.tar.gz.sha256" )
ls -la "$WORK/dist/$PKG_NAME.tar.gz"
echo "done: $WORK/dist/$PKG_NAME.tar.gz"
