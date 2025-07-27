# sv-pathfinder

[sv-pathfinder](https://github.com/heyfey/sv-pathfinder) is an open-source VS Code extension for RTL tracing and design navigation, and seamlessly integrates with the waveform viewer [VaporView](https://github.com/heyfey/sv-pathfinder)

![](https://github.com/heyfey/sv-pathfinder/blob/main/readme_assets/overview.png?raw=true)

## Getting Started

sv-pathfinder currently supports [UHDM](https://github.com/chipsalliance/UHDM) databases for design navigation.

Generating UHDM using [Surelog](https://github.com/chipsalliance/Surelog):
```bash
# ./slpp_all/surelog.uhdm will be generated
surelog dut.v tb.sv -elabuhdm -parse -sverilog -d uhdm
```

> Limitations: only supports Linux64 for now. Tested on Ubuntu 22.04

## Features

### Browse design hierarchy

![](https://github.com/heyfey/sv-pathfinder/blob/main/readme_assets/browse.gif?raw=true)

### Go back/foward

![](https://github.com/heyfey/sv-pathfinder/blob/main/readme_assets/goback.gif?raw=true)

### Select instance

![](https://github.com/heyfey/sv-pathfinder/blob/main/readme_assets/instance.gif?raw=true)


## Waveform Integration

sv-pathfinder is seamlessly integrated with VaporView – [Download](https://marketplace.visualstudio.com/items?itemName=lramseyer.vaporview)

### Signal value annotation

![](https://github.com/heyfey/sv-pathfinder/blob/main/readme_assets/value_annotation.gif?raw=true)


### Adding signals to the waveform viewer

![](https://github.com/heyfey/sv-pathfinder/blob/main/readme_assets/add_to_waveform.gif?raw=true)

## Settings

- `"sv-pathfinder.remotePathPrefix": string`
- `"sv-pathfinder.localPathPrefix": string`
    - Replace the remote path prefix with the local path prefix when jumping to source files. This is useful when the debug database is generated on the different machine/path. Only take effect when both set.

## Requirements

This extension requires VS Code 1.97.0 or later

## Acknowledgements

Many thanks to [@lramseyer](https://github.com/Lramseyer) for all of his great work and inspiration.
