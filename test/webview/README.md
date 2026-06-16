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
- **Bare Linux / WSL only:** if Chromium can't find system libs or fonts, provide them via
  `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` before the command. A desktop Linux or CI image with the
  usual Chromium dependencies needs neither.

## Related

The converter (yosys JSON → `digitaljs`) is covered separately and VS Code-free by
`src/test/converter.test.ts` — run it with `npm run test:converter`.
