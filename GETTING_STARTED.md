# Getting started

- [Prerequisites](#prerequisites)
- [Open a design](#open-a-design)
- [Schematic viewer](#schematic-viewer)
- [Waveform integration](#waveform-integration)
- [Settings](#settings)

## Prerequisites

| To use… | You need |
|---|---|
| The extension | VS Code 1.93 or newer, from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=heyfey.sv-pathfinder) |
| A `.f` filelist design | The [slang-server extension](https://marketplace.visualstudio.com/items?itemName=Hudson-River-Trading.vscode-slang), or [Surelog](https://github.com/chipsalliance/Surelog) |
| A `.uhdm` database design | Nothing (Linux x64 only) |
| Schematic viewer | Nothing. The runtime is downloaded on first use. |
| Waveform values and "Show in Waveform" | The [Vaporview](https://marketplace.visualstudio.com/items?itemName=lramseyer.vaporview) extension |

**Platforms:** Linux x64, macOS and Windows x64. Opening a `.uhdm` database works on Linux x64 only.

## Open a design

Open the **sv-pathfinder** view in the activity bar, click **Open Design**, and pick one of:

- **A `.f` filelist.** sv-pathfinder elaborates it with the
  [slang-server extension](https://marketplace.visualstudio.com/items?itemName=Hudson-River-Trading.vscode-slang),
  so install that first. To use Surelog instead, set `sv-pathfinder.compiler` to `Surelog` and
  install Surelog (or set `sv-pathfinder.surelogPath`).
- **A `.uhdm` database**, a pre-elaborated design. Nothing else is needed. The reader accepts
  databases written with UHDM v1.87. Two tools write them:
  - [Surelog](https://github.com/chipsalliance/Surelog) **v1.87** (see [BUILD_SURELOG.md](BUILD_SURELOG.md)):
    ```bash
    surelog dut.v tb.sv -elabuhdm -parse -sverilog -d uhdm   # writes ./slpp_all/surelog.uhdm
    ```
  - [slang-uhdm](https://github.com/heyfey/slang-uhdm), which writes the same database from slang
    (pick a release that writes UHDM v1.87):
    ```bash
    slang-uhdm -f design.f -o design.uhdm   # the slang command line, plus -o
    ```

## Schematic viewer

Right-click a scope in the Hierarchy view and choose **Show Schematic**. The first time,
sv-pathfinder asks to download its schematic runtime. Details and settings: [SCHEMATIC.md](SCHEMATIC.md).

## Waveform integration

Install [Vaporview](https://marketplace.visualstudio.com/items?itemName=lramseyer.vaporview) and open
a waveform. sv-pathfinder then shows signal values at the marker time in the source editor and the
schematic, and **Show in Waveform** (right-click a signal or scope) adds signals to the waveform.

## Settings

| Setting | Description |
|---|---|
| `sv-pathfinder.compiler` | `.f` backend: `slang-server` (default) or `Surelog`. |
| `sv-pathfinder.surelogPath` | Path to the Surelog executable. Empty = `surelog` from PATH. |
| `sv-pathfinder.sourcePathFrom` / `sourcePathTo` | Rewrite a path prefix when jumping to source, for a design generated on another machine. Both must be set. |
| `sv-pathfinder.showModulesView` | Show the Modules view (reload the window to apply). Default on. |
| `sv-pathfinder.valueAnnotationFormat` | Inline waveform-value format: hex, dec or bin. |
| `sv-pathfinder.schematic*` | Schematic runtime, elaboration and appearance. See [SCHEMATIC.md](SCHEMATIC.md). |

Settings that hold paths (`surelogPath`, `sourcePathFrom`, `sourcePathTo`, `schematicRuntimePath`,
`schematicIncludeDirs`) are per machine: Settings Sync does not copy them.

Building the extension from source: [DEVELOPING.md](DEVELOPING.md).
