# Wrapper project that builds the uhdm2rtlil plugin against a Yosys we built and installed ourselves
# (toolchain/build-schematic-runtime.sh stage 1), instead of uhdm2rtlil's vendored Yosys build.
#
# uhdm2rtlil's CMakeLists.txt supports a pre-built Yosys when YOSYS_CONFIG is set ("Use the Yosys
# custom location given"), but (a) its plugin still includes headers from <uhdm2rtlil>/out/current,
# so that is where we install Yosys, and (b) it still declares a dependency on a `yosys` target that
# only its vendored path defines, so we provide an empty one. Nothing upstream is modified.
#
# Usage (from the build script):
#   cmake -S toolchain/cmake -B <build> -DUHDM2RTLIL_SOURCE_DIR=<work>/uhdm2rtlil <surelog flags>
#   cmake --build <build> --target uhdm2rtlil
cmake_minimum_required(VERSION 3.20 FATAL_ERROR)
project(sv_pathfinder_schematic_runtime C CXX)

if(NOT DEFINED UHDM2RTLIL_SOURCE_DIR)
  message(FATAL_ERROR "set -DUHDM2RTLIL_SOURCE_DIR=<path to the uhdm2rtlil checkout>")
endif()
set(YOSYS_PREFIX "${UHDM2RTLIL_SOURCE_DIR}/out/current")
if(NOT EXISTS "${YOSYS_PREFIX}/bin/yosys-config")
  message(FATAL_ERROR "no Yosys installed at ${YOSYS_PREFIX} (run stage 1 of build-schematic-runtime.sh first)")
endif()

# Selects uhdm2rtlil's pre-built-Yosys branch.
set(YOSYS_CONFIG "${YOSYS_PREFIX}/bin/yosys-config" CACHE FILEPATH "yosys-config of the pre-built Yosys" FORCE)
set(YOSYS_PATH "${YOSYS_PREFIX}/share/yosys/include" CACHE PATH "installed Yosys headers" FORCE)
# Stands in for the vendored-Yosys build target that uhdm2rtlil's add_dependencies() names.
add_custom_target(yosys)

add_subdirectory("${UHDM2RTLIL_SOURCE_DIR}" uhdm2rtlil)
