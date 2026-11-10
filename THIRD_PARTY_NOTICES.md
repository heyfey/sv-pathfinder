# Third-party notices

sv-pathfinder redistributes the third-party components below. Their licenses apply to those
components only; sv-pathfinder's own code is covered by [LICENSE](LICENSE).

- **Bundled npm packages** — full license texts for every production dependency are collected in
  **[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)** (auto-generated; see *Regenerating* below).
- **Native / vendored / data components** — npm tooling can't see these, so they're documented here.

## Components requiring explicit attribution

### Icons — `@vscode/codicons` (CC-BY-4.0)
[Codicons](https://github.com/microsoft/vscode-codicons) © Microsoft Corporation, licensed under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Used unmodified for the tree, toolbar, and
status-bar icons.

### Schematic layout — `elkjs` (EPL-2.0)
[elkjs](https://github.com/kieler/elkjs) is licensed under the
[Eclipse Public License 2.0](https://www.eclipse.org/legal/epl-2.0/). It is bundled **unmodified** as
part of the schematic; its source is available at the link above.

### Schematic diagramming — JointJS `@joint/core`, `@joint/layout-directed-graph` (MPL-2.0)
[JointJS](https://github.com/clientIO/joint) is licensed under the
[Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). Pulled in (unmodified) via
[digitaljs](https://github.com/tilk/digitaljs); source available at the link above.

> EPL-2.0 and MPL-2.0 are file-level weak-copyleft: because these packages are bundled unmodified,
> reproducing their license and pointing to their upstream source (done above) satisfies them — they
> do not affect sv-pathfinder's own code.

## Native binary — `build/Release/uhdm_addon.node`

The prebuilt UHDM reader (used for `.uhdm` databases) statically links:

- **UHDM** — [chipsalliance/UHDM](https://github.com/chipsalliance/UHDM), **Apache-2.0**. Preserve
  UHDM's `NOTICE` and `LICENSE` (Apache-2.0 full text is in THIRD_PARTY_LICENSES.txt).
- UHDM in turn includes **Cap'n Proto** (MIT) — verify what is statically linked into the shipped
  `.node` and attribute accordingly.

## Bundled data — `parsers/tree-sitter-systemverilog.wasm`

The compiled tree-sitter SystemVerilog grammar from
[gmlarumbe/tree-sitter-systemverilog](https://github.com/gmlarumbe/tree-sitter-systemverilog)
(**MIT**) — prebuilt `.wasm` from release v0.3.1.

## Vendored source — `src/slang_server/`

`SlangInterface.ts` and `config.gen.ts` are checked-in copies of client glue from
[hudson-trading/slang-server](https://github.com/hudson-trading/slang-server), **MIT**,
© 2024–2025 Hudson River Trading LLC. The MIT notice is preserved in each file's header.

## Downloaded at run time — the schematic runtime (not inside the VSIX)

On the first schematic request the extension offers to download `sv-pathfinder-schematic-runtime-
<platform>-<version>.tar.gz` from this project's GitHub releases (pins in `toolchain/versions.json`).
Every archive ships the license texts of what it contains in its `LICENSES/` directory.

### Linux x64 — built from source

`toolchain/build-schematic-runtime.sh` builds it inside an AlmaLinux 8 container:

- [Yosys](https://github.com/YosysHQ/yosys) (ISC; the `alainmarcel/yosys` fork pinned by uhdm2rtlil),
  built without readline and Tcl. ABC is compiled (the v0.70 fork's slang integration requires it)
  but only `bin/yosys` is shipped, not `yosys-abc`.
- [slang](https://github.com/MikePopoloski/slang) (MIT) and its `sv-elab` Yosys frontend, built into
  that Yosys as `read_slang`; Yosys's bundled libs fmt (MIT), cxxopts (MIT), tomlplusplus (MIT),
  boost regex (BSL-1.0).
- [uhdm2rtlil](https://github.com/alainmarcel/uhdm2rtlil) (Apache-2.0) — the `read_uhdm` plugin,
  statically linking [Surelog](https://github.com/chipsalliance/Surelog) (Apache-2.0),
  [UHDM](https://github.com/chipsalliance/UHDM) (Apache-2.0), ANTLR4 (BSD-3) and Cap'n Proto (MIT).

### macOS (arm64, x64) and Windows x64 — repacked from OSS CAD Suite

`toolchain/repack-oss-cad-suite.sh` takes the pinned [OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build)
release (built and distributed by YosysHQ; tag and SHA-256 per platform in `toolchain/versions.json`)
and keeps only what `read_slang` needs:

- [Yosys](https://github.com/YosysHQ/yosys) (ISC) as the suite builds it, with its launcher script
  (macOS) and the shared libraries it links: GNU Readline (GPL-3.0), libffi (MIT), zlib (zlib),
  Tcl (Tcl/BSD-style, Windows), ncurses (MIT-style, macOS), libstdc++/libgcc and the MinGW runtime
  (GPL-3.0 with the GCC Runtime Library Exception; Windows).
- The [yosys-slang](https://github.com/povik/yosys-slang) plugin (ISC) with
  [slang](https://github.com/MikePopoloski/slang) (MIT), loaded as `yosys -m slang`.
- `share/yosys` (Yosys's techmap and simulation libraries, ISC).

The suite's `LICENSE.yosys` and `LICENSE.yosys-slang-plugin` texts travel in `LICENSES/`, with a
`NOTICE.txt` that lists the bundled libraries and points at the oss-cad-suite-build repository,
where the build recipes and the source of every component (including the GPL ones) live. No
`read_uhdm` on these platforms.

## External tools (not bundled — acknowledgement only)

These are run as separate processes / extensions that the user installs; sv-pathfinder does **not**
redistribute them, so no license obligation falls on this package — credited here with thanks:

- [Surelog](https://github.com/chipsalliance/Surelog) — the Surelog/UHDM backend.
- [slang-server VS Code extension](https://github.com/hudson-trading/slang-server) — the default
  navigation backend.
- [VaporView](https://github.com/Lramseyer/vaporview) — waveform integration.

## Regenerating the bundled-npm license texts

`THIRD_PARTY_LICENSES.txt` is generated from the production dependency tree. After changing
dependencies, regenerate it:

```bash
npx --yes generate-license-file --input package.json --output THIRD_PARTY_LICENSES.txt --overwrite --no-spinner
```

The components in *this* file (UHDM, tree-sitter grammar, vendored slang-server, external tools) are
maintained by hand and are **not** affected by regeneration.
