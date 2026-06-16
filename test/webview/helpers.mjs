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

// Launch a headless page on the test host. Needs the built bundle (`node esbuild.js`) and, on a bare
// WSL box, LD_LIBRARY_PATH + FONTCONFIG_FILE for chromium's system libs/fonts (see README.md).
export async function launchPage(viewport = { width: 1500, height: 950 }) {
    const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'] });
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
