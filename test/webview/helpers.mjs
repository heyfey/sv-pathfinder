// Shared helpers for the headless webview tests. They render the BUILT bundle (dist/) in a chromium
// page on host.html and drive it via window.postMessage, exactly as the extension does.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HOST = 'file://' + path.join(here, 'host.html');

// Load a fixture circuit (the digitaljs JSON the converter would produce).
export function fixture(name) {
    return JSON.parse(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'));
}

// On a box whose Chromium system libs/fonts aren't installed (no sudo), they can be supplied from a
// local bundle WITHOUT polluting the shell: set SV_WEBVIEW_CHROMIUM_LIBS / SV_WEBVIEW_FONTCONFIG, or
// drop a gitignored test/webview/local-env.json ({ "LD_LIBRARY_PATH": "...", "FONTCONFIG_FILE": "..." }).
// We inject them into the launched browser's env so neither the npm script nor the shell needs them.
// Returns undefined when nothing is configured (the normal case: system libs are installed).
function browserLaunchEnv() {
    let cfg = {};
    const jsonPath = path.join(here, 'local-env.json');
    if (fs.existsSync(jsonPath)) {
        try { cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { /* ignore malformed */ }
    }
    const libs = process.env.SV_WEBVIEW_CHROMIUM_LIBS || cfg.LD_LIBRARY_PATH;
    const fonts = process.env.SV_WEBVIEW_FONTCONFIG || cfg.FONTCONFIG_FILE;
    if (!libs && !fonts) { return undefined; }
    const env = { ...process.env };
    if (libs) { env.LD_LIBRARY_PATH = libs + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''); }
    if (fonts) { env.FONTCONFIG_FILE = fonts; }
    return env;
}

// Launch a headless page on the test host. Needs the built bundle (`node esbuild.js`) and Chromium's
// system libs/fonts — installed system-wide, or supplied via a local bundle (see browserLaunchEnv).
export async function launchPage(viewport = { width: 1500, height: 950 }) {
    let browser;
    try {
        browser = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'], env: browserLaunchEnv() });
    } catch (e) {
        if (/loading shared libraries|cannot open shared object|missing dependencies/i.test(String(e))) {
            console.error(
                '\nChromium could not start — its system libraries/fonts are missing. Install them\n' +
                '(`npx playwright install-deps chromium`, or your distro packages), or point this run at a\n' +
                'local bundle via SV_WEBVIEW_CHROMIUM_LIBS / SV_WEBVIEW_FONTCONFIG. See test/webview/README.md.\n');
        }
        throw e;
    }
    const page = await browser.newPage({ viewport });
    const logs = [];
    page.on('console', m => logs.push(m.text()));
    page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
    await page.goto(HOST);
    await page.waitForTimeout(700);
    return { browser, page, logs };
}

// Post a loadSchematic message with the named fixture and wait for the async ELK layout.
export async function loadSchematic(page, fixtureName, msg = {}) {
    const circuit = fixture(fixtureName);
    await page.evaluate((m) => window.postMessage(m, '*'),
        { type: 'loadSchematic', scopePath: 'tb', moduleName: 'top', ...msg, circuit });
    await page.waitForTimeout(4000);
}

// Print a checklist and return whether all passed (the test then process.exit(ok ? 0 : 1)).
export function report(name, checks, logs) {
    let ok = true;
    for (const [label, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`); ok = ok && pass; }
    if (logs && logs.some(l => l.startsWith('PAGEERROR'))) { console.log('LOGS:', JSON.stringify(logs.slice(0, 8))); }
    console.log(ok ? `${name}: PASS` : `${name}: FAIL`);
    return ok;
}
