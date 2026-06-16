// Run every test/webview/*.test.mjs as a child process and report pass/fail by exit code.
// Usage: node test/webview/run.mjs [name-substring]   (filter to one or a few tests)
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
let tests = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();
if (only) { tests = tests.filter(f => f.includes(only)); }
if (tests.length === 0) { console.error('no webview tests matched'); process.exit(1); }

const failed = [];
for (const t of tests) {
    console.log(`\n──── ${t} ────`);
    const r = spawnSync(process.execPath, [path.join(here, t)], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) { failed.push(t); }
}
console.log(`\n${tests.length - failed.length}/${tests.length} webview tests passed`);
if (failed.length) { console.log('FAILED: ' + failed.join(', ')); process.exit(1); }
