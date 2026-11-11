# Change Log

All notable changes to the "sv-pathfinder" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Changed

- Native UHDM reader rebuilt against UHDM v1.87 (was v1.84); use Surelog v1.87 to
  generate compatible `.uhdm` databases. The bundled example database was regenerated
  with Surelog v1.87.
- UHDM is now pinned as the `third_party/UHDM` git submodule and built by
  `npm run build-uhdm` (`scripts/build-uhdm.sh`); `binding.gyp` no longer hardcodes a
  machine-specific path (`UHDM_HOME` overrides the submodule build).

### Fixed

- Opening a missing, truncated or otherwise unreadable `.uhdm` file now fails with an error
  message instead of aborting the extension host. The reader also exports `uhdmVersion`.
- `loadDesign`, `getModuleDefs` and `searchInstances` left their promise pending forever
  on failure; they now reject.
- Windows: "Open Design" showed a folder-only dialog (a files-and-folders dialog is folder-only
  on Windows and native Linux), so no `.f` or `.uhdm` could be picked. It is a file dialog now.
- Windows: paths written into the rewritten filelist used backslashes, which slang reads as
  escape characters (`c:Userstsung...`). Generated filelists and Yosys scripts use forward
  slashes on Windows.
- Every path setting (`sourcePathFrom`, `sourcePathTo`, `surelogPath`, `schematicRuntimePath`,
  `schematicIncludeDirs`) is machine-scoped now (Settings Sync no longer copies one machine's paths
  to another). On Windows the `sourcePathFrom` match ignores drive-letter case and `\` vs `/`. A configured
  include directory that does not exist on this machine is skipped with a log line instead of
  failing the whole Yosys run ("Bad command").
- The slang-server extension is activated before its commands are used (every platform): it
  activates itself only when the workspace contains a `.sv`/`.v` file, so a design opened from a
  folder without sources failed with "command 'slang.setBuildFile' not found". A missing extension
  is now reported by name.

### Added

- Interactive schematic viewer (preview): "Show Schematic" on a hierarchy scope,
  instance, or from the editor context menu renders the RTL structure of the active
  instance (Yosys + yosys2digitaljs + digitaljs). Includes click-to-source
  cross-navigation, instance-accurate parameter elaboration, an RTL/GLS view toggle,
  and live signal-value annotation from VaporView at the waveform cursor.
  - Navigation: a go-to-parent button to move up the hierarchy; child instances rendered
    as labeled, accent-filled boxes that navigate to the child's module declaration.
  - Controls: Ctrl+scroll to zoom around the cursor, drag/wheel to pan, fit/zoom toolbar,
    and a navigation overview — scrollbars on the main schematic, and overlay scrollbars
    on subcircuit popup windows.
  - Visuals: configurable single accent color, theme-aware wire value colors, and a
    hover highlight that names the cell/net/port in the status bar.
  - Read-only: digitaljs's editor/simulator affordances (wire delete/monitor tools,
    input toggling, memory/FSM content editors) are disabled.
- Managed schematic runtime: on the first schematic request sv-pathfinder offers to download one
  Yosys (with `read_slang` built in and the uhdm2rtlil `read_uhdm` plugin) from its GitHub
  releases, verifies its SHA-256, self-tests it, and installs it into the extension's global
  storage. Command `sv-pathfinder: Install Schematic Runtime` re-downloads it. Linux x64
  (AlmaLinux 8 baseline) is built from pinned sources by `toolchain/build-schematic-runtime.sh`
  (uhdm2rtlil v0.70.2, its Yosys v0.70 fork, Surelog v1.87+130 / UHDM v1.87+48 — databases
  from Surelog v1.87 load unchanged, verified both ways). macOS (arm64, x64) and Windows x64 get
  a slang-only runtime (`read_slang`, no `read_uhdm`) repacked from a pinned
  [OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build) release by
  `toolchain/repack-oss-cad-suite.sh`; a `.uhdm` design is drawn from its source files there.
  The install self-test now elaborates a real module through `read_slang` instead of asking for
  help text (Yosys exits 0 for an unknown command).
- Setting `sv-pathfinder.schematicRuntimePath` (and env `SV_PATHFINDER_SCHEMATIC_RUNTIME`) to
  point the schematic at a runtime directory of your own.
- Schematics for directly opened `.uhdm` designs through `read_uhdm` (experimental, Linux x64
  runtime): the elaborated database is imported as it is, no defines/includes/parameters
  re-supplied. Setting `sv-pathfinder.schematicUhdmFrontend` (`auto` default): when the importer
  fails, the schematic falls back to re-parsing the source files with `read_slang` as before —
  now with every source file and include directory the database records (packages included),
  through a generated filelist (Yosys truncates long commands).
- A Yosys process killed by a signal (crash, out of memory) is now reported as such instead of
  "failed with code -1".

### Removed

- Detection of an installed OSS CAD Suite / `yosys` on PATH and the `yowasp-yosys` WASM fallback,
  with the setting `sv-pathfinder.ossCadSuitePath` and the "limited engine" badge. Use
  `sv-pathfinder.schematicRuntimePath` to point at a Yosys build of your own.
- Setting `sv-pathfinder.schematicAccentColor` for the schematic accent color.

- Initial release