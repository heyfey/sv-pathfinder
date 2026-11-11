# Schematic viewer

The schematic draws the RTL (or gate-level) structure of any scope: ports, sub-instances, logic and
wires, elaborated with Yosys.

![](readme_assets/schematic.png)

## Setup

1. Right-click a scope in the Hierarchy view and choose **Show Schematic**.
2. The first time, sv-pathfinder asks to download the schematic runtime (about 15 to 30 MB, from this
   project's [GitHub releases](https://github.com/heyfey/sv-pathfinder/releases)). Click **Install**.

That is all. Later schematics reuse the installed runtime. Platforms: Linux x64 (RHEL/AlmaLinux 8
or newer), macOS (Apple silicon and Intel), Windows x64.

To download the runtime again, or to repair a broken install, run the command
**sv-pathfinder: Install Schematic Runtime**.

## Which designs can be drawn

- **`.f` filelist designs**: always. The schematic re-reads the sources listed in the `.f`.
- **`.uhdm` database designs**: the schematic reads the database directly, defines and parameters
  included. When that fails for a design, sv-pathfinder tells you once and draws it from the
  database's source files instead, without the `+define+` options.

## Elaboration modes

- **`shallow`** (default): elaborates the selected scope and one level below, with children as boxes,
  and elaborates the next level when you step in or expand. Cheapest on large designs.
- **`full`**: elaborates the opened scope once; step in, expand and step out reuse that result.
  Only navigating above the opened scope elaborates again. Best for small and medium designs.

## Curated or partial filelists (`.f` designs)

Yosys needs a self-contained filelist. The `.f`'s own directory and each source file's directory are
searched automatically, so a `.f` that omits sibling modules (like ibex's `ibex_core.f`) still works.

- If `` `include`` headers live outside the source tree, add their directories to
  `sv-pathfinder.schematicIncludeDirs`. A schematic error that names a missing file or an unknown
  module points here.
- The schematic can then show a sub-instance that the hierarchy tree does not have, because the
  navigation backend only sees the files the `.f` lists. **Step into** on such an instance explains
  this and offers **Go to source**. Add the missing source to the `.f` to navigate it fully.

## Settings

| Setting | Description |
|---|---|
| `sv-pathfinder.schematicRuntimePath` | Folder of a runtime archive you extracted by hand (contains `bin/yosys`), e.g. on a machine without internet access. Empty = the downloaded one. Per machine. |
| `sv-pathfinder.schematicElaborationMode` | `shallow` (default) or `full`, see above. |
| `sv-pathfinder.schematicUhdmFrontend` | How `.uhdm` designs are drawn: `auto` (default), `read_uhdm` (database only) or `read_slang` (source files only). |
| `sv-pathfinder.schematicIncludeDirs` | Extra `` `include`` search directories. Per machine; a directory missing on this machine is skipped. |
| `sv-pathfinder.schematicAccentColor` | Accent color for child-instance fills and hover highlights. Any CSS color; empty = theme default. |
| `sv-pathfinder.schematicShowDanglingNets` | Show declared but unconnected nets. Default off. |
| `sv-pathfinder.schematicSpacing` | Layout density: `compact`, `comfortable` (default) or `spacious`. |
