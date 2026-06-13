# Change Log

All notable changes to the "sv-pathfinder" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- Interactive schematic viewer (preview): "Show Schematic" on a hierarchy scope,
  instance, or from the editor context menu renders the RTL structure of the active
  instance (Yosys + yosys2digitaljs + digitaljs). Includes click-to-source
  cross-navigation, instance-accurate parameter elaboration, an RTL/GLS view toggle,
  and live signal-value annotation from VaporView at the waveform cursor.
  - Navigation: a go-to-parent button to move up the hierarchy; child instances rendered
    as labeled, accent-filled boxes that navigate to the child's module declaration.
  - Controls: Ctrl+scroll to zoom around the cursor, drag-to-pan, fit/zoom toolbar.
  - Visuals: configurable single accent color, theme-aware wire value colors, and a
    hover highlight that names the cell/net/port in the status bar.
  - Read-only: digitaljs's editor/simulator affordances (wire delete/monitor tools,
    input toggling, memory/FSM content editors) are disabled.
- Setting `sv-pathfinder.ossCadSuitePath` for locating the Yosys/yosys-slang toolchain.
- Setting `sv-pathfinder.schematicAccentColor` for the schematic accent color.

- Initial release