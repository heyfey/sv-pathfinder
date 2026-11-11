# Developing sv-pathfinder

## Build the extension

```sh
git submodule update --init --recursive   # UHDM + its capnproto dependency (Linux x64 only)
npm install
npm run build-uhdm                         # builds third_party/UHDM (Release, -fPIC, no tests)
npm run compile                            # node-gyp rebuild + type-check + lint + esbuild
```

The `.uhdm` reader is a native Node addon linked against the `third_party/UHDM` submodule. The
reference platform is AlmaLinux 8 with the GCC toolset, which CI uses and which keeps the binary
loadable on EL8 and EL9:

```sh
sudo dnf install gcc-toolset-14 cmake make python3.11 python3.11-pip
sudo alternatives --set python3 /usr/bin/python3.11
python3 -m pip install --user orderedmultidict   # UHDM's code generator
scl enable gcc-toolset-14 bash
```

`binding.gyp` reads the UHDM build from `third_party/UHDM/build`; set `UHDM_HOME=/path/to/build` to
use another build (compiled with `-DCMAKE_POSITION_INDEPENDENT_CODE=ON`).

On macOS and Windows, skip the two UHDM steps: `npm install` then `npm run watch` (or F5 in VS Code).
Everything except opening `.uhdm` databases works there.

## Tests

```sh
npm run test:unit      # mocha unit tests (out/test)
npm run test:webview   # schematic webview tests
```

## The schematic runtime

The runtime the schematic downloads is built by the "Schematic runtime" GitHub workflow from the
pins in `toolchain/versions.json`: Linux x64 from source (`toolchain/build-schematic-runtime.sh`),
macOS and Windows as slang-only repacks of [OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build)
(`toolchain/repack-oss-cad-suite.sh`). Run
the workflow by hand; `publish=true` on `main` creates the tag and the release. Afterwards copy the
published SHA-256 of each archive into `toolchain/versions.json`.
