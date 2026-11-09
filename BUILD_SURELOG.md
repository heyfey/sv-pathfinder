# Build Surelog (v1.87)

This extension is built with UHDM v1.87 (the `third_party/UHDM` submodule). The `.uhdm` format is not stable across UHDM releases, so use Surelog v1.87 to generate databases; the reader rejects a database from another release.

```
git clone https://github.com/chipsalliance/Surelog.git Surelog-1.87
cd Surelog-1.87
git checkout v1.87
git submodule update --init --recursive
make
```

Reference: [Surelog - Build instructions and test](https://github.com/chipsalliance/Surelog?tab=readme-ov-file#build-instructions-and-test)