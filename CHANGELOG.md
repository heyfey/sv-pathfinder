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
- Setting `sv-pathfinder.ossCadSuitePath` for locating the Yosys/yosys-slang toolchain.

- Initial release