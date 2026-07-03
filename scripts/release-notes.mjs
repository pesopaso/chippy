// SPDX-License-Identifier: Apache-2.0
//
// release-notes.mjs — pull the changelog section for one version.
//
// documentation/changelog.md uses entries shaped like:
//   ### v3.0.0 — 2026-06-07 — Production release
//   > summary line
//   - detail
//   - detail
// running until the next "### " heading or a "## " section heading.
//
// This extracts the block for a given version so the release workflow can use it
// as the GitHub Release body. Fails (exit 1) if no entry exists — that is the
// guard that forces a changelog entry before a release can be cut.
//
// Usage:
//   node scripts/release-notes.mjs 3.1.0            # print notes to stdout
//   node scripts/release-notes.mjs 3.1.0 out.md     # also write to a file

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(ROOT, 'documentation', 'changelog.md');

const version = (process.argv[2] || '').replace(/^v/, '');
const outFile = process.argv[3];
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs <version> [outFile]');
  process.exit(1);
}

const lines = readFileSync(CHANGELOG, 'utf8').split(/\r?\n/);

// Match "### vX.Y.Z" allowing optional " — title" after it. Escape dots.
const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headRe = new RegExp(`^###\\s+v${esc}(?:\\b|\\s|$)`);

let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (headRe.test(lines[i])) { start = i; break; }
}
if (start === -1) {
  console.error(`No changelog entry found for v${version} in ${CHANGELOG}`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^###\s+/.test(lines[i]) || /^##\s+/.test(lines[i])) { end = i; break; }
}

const block = lines.slice(start, end).join('\n').trim() + '\n';
if (outFile) writeFileSync(outFile, block);
process.stdout.write(block);
