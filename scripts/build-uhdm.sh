#!/usr/bin/env bash
# Build the UHDM submodule the way the native addon (binding.gyp) needs it:
# a Release static library compiled with -fPIC, no tests.
#
#   git submodule update --init --recursive
#   npm run build-uhdm            # or: scripts/build-uhdm.sh
#   npm run compile-addon
#
# Environment:
#   UHDM_SRC   UHDM source tree       (default: third_party/UHDM)
#   UHDM_HOME  UHDM build directory   (default: $UHDM_SRC/build; binding.gyp reads the same variable)
#   JOBS       parallel build jobs    (default: number of CPUs)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${UHDM_SRC:-$ROOT/third_party/UHDM}"
BUILD="${UHDM_HOME:-$SRC/build}"
JOBS="${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

if [ ! -f "$SRC/CMakeLists.txt" ] || [ ! -f "$SRC/third_party/capnproto/CMakeLists.txt" ]; then
  echo "UHDM sources not found at $SRC. Run: git submodule update --init --recursive" >&2
  exit 1
fi

# Reference platform: AlmaLinux 8 with gcc-toolset (scl enable gcc-toolset-14 bash), cmake >= 3.20,
# python3 >= 3.8 with the orderedmultidict module (UHDM's code generator).
gcc_major="$(${CXX:-g++} -dumpversion 2>/dev/null | cut -d. -f1 || echo 0)"
if [ "${gcc_major:-0}" -lt 10 ]; then
  echo "warning: $(${CXX:-g++} --version 2>/dev/null | head -1 || echo 'no g++') is older than GCC 10;" \
       "on EL8 run: scl enable gcc-toolset-14 bash" >&2
fi

cmake -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
  -DUHDM_BUILD_TESTS=OFF
cmake --build "$BUILD" --target uhdm -j"$JOBS"

echo "UHDM built in $BUILD"
