// Re-vendor the slang-server VS Code client glue (SlangInterface.ts, config.gen.ts) from
// hudson-trading/slang-server at a pinned commit. These files are copied verbatim — we don't
// modify them — with an attribution + pinned-ref header prepended.
//
// Usage:
//   node scripts/vendor-slang-server.mjs [ref]     # ref defaults to "main"; pass a tag/sha to pin
//   npm run vendor-slang-server -- <ref>
//
// After running: review `git diff src/slang_server/`, then `npm run check-types` and fix any API
// drift in the call sites (the script fetches the files; you adapt to upstream renames).
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = 'hudson-trading/slang-server';
const SRC_DIR = 'clients/vscode/src';
const FILES = ['SlangInterface.ts', 'config.gen.ts'];
const ref = process.argv[2] || 'main';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'slang_server');

// Resolve a branch/tag/sha to a full commit SHA so the header records the exact commit
// (falls back to the given ref string when offline).
async function resolveSha(r) {
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${r}`, {
            headers: { Accept: 'application/vnd.github.sha' },
        });
        if (res.ok) { return (await res.text()).trim(); }
    } catch { /* offline → use the ref as-is */ }
    return r;
}

const sha = await resolveSha(ref);
const shortSha = /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : sha;

for (const file of FILES) {
    const url = `https://raw.githubusercontent.com/${REPO}/${sha}/${SRC_DIR}/${file}`;
    const res = await fetch(url);
    if (!res.ok) { throw new Error(`fetch ${url} -> HTTP ${res.status}`); }
    const header =
        `// Checked in from https://github.com/${REPO}/blob/main/${SRC_DIR}/${file}\n` +
        `// Copyright (c) 2024-2025 Hudson River Trading LLC. Licensed under the MIT License.\n` +
        `// SPDX-License-Identifier: MIT\n` +
        `// Vendored from ${REPO}@${shortSha} — re-sync with: npm run vendor-slang-server\n`;
    await writeFile(join(outDir, file), header + (await res.text()));
    console.log(`vendored ${file} from ${REPO}@${shortSha}`);
}
console.log('Done. Review: git diff src/slang_server/  →  then: npm run check-types');
