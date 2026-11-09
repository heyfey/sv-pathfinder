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
- Setting `sv-pathfinder.ossCadSuitePath` for locating the Yosys/yosys-slang toolchain.
- Setting `sv-pathfinder.schematicAccentColor` for the schematic accent color.

- Initial release