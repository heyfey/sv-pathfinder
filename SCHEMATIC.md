# Schematic Viewer

The schematic renders the RTL (or gate-level) structure of any scope — ports, sub-instances, logic, and wires — elaborated with Yosys

![](readme_assets/schematic.png)

## Setup (managed runtime)

The schematic runs on a **sv-pathfinder-managed runtime**: one Yosys with the `slang` SystemVerilog
frontend built in (`read_slang`) and the [uhdm2rtlil](https://github.com/alainmarcel/uhdm2rtlil)
plugin (`read_uhdm`). You do not install Yosys yourself:

1. Right-click a scope in the Hierarchy view → **Show Schematic**.
2. On first use sv-pathfinder asks once to download the runtime (from this project's
   [GitHub releases](https://github.com/heyfey/sv-pathfinder/releases); SHA-256 verified, self-tested
   before it is installed into the extension's global storage). Later schematics reuse it.
3. **Linux x64** only for now (built on AlmaLinux 8, so it runs on EL8/EL9 and newer distributions).
   macOS and Windows `read_slang` packages are planned.

Re-download or repair with the command **sv-pathfinder: Install Schematic Runtime**.

**Override** (air-gapped sites, developers): point `sv-pathfinder.schematicRuntimePath` — or the
environment variable `SV_PATHFINDER_SCHEMATIC_RUNTIME` — at a directory that contains `bin/yosys`
(and `share/yosys/plugins/uhdm2rtlil.so` for `.uhdm` designs). Download the same release archive by
hand and extract it there; the setting wins over the variable. The runtime is built from pinned
sources by `toolchain/build-schematic-runtime.sh` (see `toolchain/versions.json`).

> **macOS (override only):** downloaded binaries may be blocked by Gatekeeper on first run. Clear
> the quarantine flag on the runtime folder once, then reload the window:
> ```bash
> xattr -dr com.apple.quarantine "/path/to/runtime"
> ```

## Frontends

- **`.f` designs → `read_slang`.** The filelist is re-parsed with the instance's resolved parameters
  (`-G`), `-D SYNTHESIS`, and the search directories described below.
- **`.uhdm` designs → `read_uhdm` first, `read_slang` as fallback** (`schematicUhdmFrontend`, default
  `auto`). `read_uhdm` (Linux x64) imports the already elaborated database as it is: defines, includes
  and parameters were resolved by Surelog, so nothing has to be re-supplied, and every
  parameterization is a separate module. The importer ([uhdm2rtlil](https://github.com/alainmarcel/uhdm2rtlil)
  v0.68) is **experimental**: it fails on some real designs (known: interface ports inside generate
  loops, parameter conditions inside async resets, some hierarchical references in generate scopes,
  and a crash on one design). When it fails, `auto` warns once and re-parses the source files the
  database points to with `read_slang`, using the `+incdir+`/`+define+`/`-P` options recovered from
  Surelog's `slpp_all/surelog.log` next to the database (and the `-f` files it names). Keep that
  directory with the database; without the log, set `schematicIncludeDirs` if headers are missing.
  The database must come from the Surelog release the extension's UHDM reader is built for (see
  GETTING_STARTED.md).
- A plain `yosys` on PATH or an installed OSS CAD Suite is **not** detected; use the override above
  if you want a specific Yosys build.

## Elaboration modes (`schematicElaborationMode`)

- **`shallow`** *(default)* — elaborates only the selected scope + one level (children as boxes) and
  re-elaborates the next level on demand as you step in or expand. Cheapest to start on large designs.
- **`full`** — the scope you open is elaborated **once**; rendering it, plus step-into, expand, and
  stepping back up, all come from that single elaboration with no re-elaboration. Only navigating
  *above* what you've opened elaborates again. (Rooting at the opened scope, not the design's absolute
  top, avoids elaborating a non-synthesizable testbench above the DUT.) Best for small/medium designs.

## Curated / partial filelists

Unlike the language server, Yosys needs a **self-contained** filelist. The filelist's own directory
and each source file's directory are searched automatically, so a `.f` that omits sibling modules
(like [ibex](https://github.com/lowrisc/ibex)'s `ibex_core.f`) still resolves them.

- If `` `include`` headers live **outside** the source tree (e.g. ibex's vendored `prim_assert.sv` /
  `dv_fcov_macros.svh`), add their directories to **`sv-pathfinder.schematicIncludeDirs`**. A
  schematic error naming a missing file or unknown module points here.
- **Flip side:** Yosys searches those directories, but the navigation backend sees only the files the
  `.f` lists — so the schematic can show a sub-instance the hierarchy tree doesn't have (e.g. ibex's
  `wb_stage_i`, whose `ibex_wb_stage.sv` is omitted from `ibex_core.f`). **Step into** on such an
  instance can't open its scope; it explains why and offers **Go to source** instead. Add the missing
  source to the `.f` to navigate it fully.

## Schematic settings

| Setting | Description |
|---|---|
| `sv-pathfinder.schematicRuntimePath` | Override: a runtime dir (the `bin/yosys` parent). Empty = the managed runtime, downloaded on first use. `SV_PATHFINDER_SCHEMATIC_RUNTIME` is honoured when empty. |
| `sv-pathfinder.schematicElaborationMode` | `shallow` (default) or `full` — see above. |
| `sv-pathfinder.schematicUhdmFrontend` | `.uhdm` designs: `auto` (default: `read_uhdm`, fall back to `read_slang`), `read_uhdm`, or `read_slang`. |
| `sv-pathfinder.schematicIncludeDirs` | Extra `` `include`` search dirs for Yosys elaboration. |
| `sv-pathfinder.schematicAccentColor` | Accent color for child-instance fills / hover highlights. Any CSS color; empty = theme-aware default. |
| `sv-pathfinder.schematicShowDanglingNets` | Surface declared-but-unconnected nets. Default off. |
| `sv-pathfinder.schematicSpacing` | Layout density: `compact` / `comfortable` (default) / `spacious`. |
