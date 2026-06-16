# Schematic webview tests

Headless tests for the schematic viewer's webview. They render the **built** bundle
(`dist/schematic_webview.{js,css}`) in a real Chromium page and drive it through `window.postMessage`
exactly as the extension does — so they exercise the layout, value annotation, coloring, and
robustness logic end to end, without a VS Code instance.

## Layout

| File | Role |
| --- | --- |
| `host.html` | Test harness: mocks `acquireVsCodeApi`, loads the built bundle, exposes `window.__schematic`. |
| `helpers.mjs` | `launchPage()`, `loadSchematic()`, `fixture()`, `report()` — shared across tests. |
| `run.mjs` | Runs every `*.test.mjs` as a child process; reports `N/M passed`, exits non-zero on failure. |
| `*.test.mjs` | One concern each (smoke, port/wire values, x/z colors, transitions, change-flash, inout, IO boxes, instance coloring, malformed input). |
| `fixtures/` | `digitaljs` JSON the converter would produce. `fifo.digitaljs.json` is a generic parametrizable FIFO; `inout.digitaljs.json` is a synthetic two-instance `inout` bus. |

Each test posts messages (`loadSchematic`, `setValues`, `clearValues`, …) and inspects the rendered
JointJS graph / DOM via `window.__schematic` (`{ circuit, paper, labelIndex, fit }`).

## Running

```sh
npm run test:webview            # builds dist/, then runs the whole suite
node test/webview/run.mjs xvalue  # run only tests whose filename contains "xvalue"
```

### Prerequisites

- **A Chromium for `playwright-core`.** `playwright-core` does not download browsers; install one with
  `npx playwright install chromium` (or point `PLAYWRIGHT_BROWSERS_PATH` at an existing cache).
- **The built bundle.** `npm run test:webview` runs `node esbuild.js` first; if you invoke `run.mjs`
  directly, build the bundle yourself.
- **Chromium's system libraries and fonts.** A desktop Linux or CI image with the usual Chromium
  dependencies already has these. On a minimal box (e.g. a headless server / WSL distro) Chromium fails
  to launch with `error while loading shared libraries: libatk-1.0.so.0` or similar. Two ways to fix it:
  - **Install them system-wide (preferred):** `npx playwright install-deps chromium`, or your distro's
    packages — e.g. on RHEL/AlmaLinux 8: `sudo dnf install atk at-spi2-atk at-spi2-core libX11
    libXcomposite libXdamage libXext libXfixes libXrandr mesa-libgbm libxcb dejavu-sans-fonts`. After
    this no env config is needed.
  - **No sudo? Supply a local bundle.** Point the run at a directory of the needed `.so` files and a
    fontconfig file, and the harness injects them into the browser's environment only — without
    touching your shell. Configure either via env vars
    (`SV_WEBVIEW_CHROMIUM_LIBS=/path/to/libs SV_WEBVIEW_FONTCONFIG=/path/to/fonts.conf npm run test:webview`)
    or a gitignored `test/webview/local-env.json`:

    ```json
    { "LD_LIBRARY_PATH": "/path/to/libs", "FONTCONFIG_FILE": "/path/to/fonts.conf" }
    ```

## Related

The converter (yosys JSON → `digitaljs`) is covered separately and VS Code-free by
`src/test/converter.test.ts` — run it with `npm run test:converter`.
