// SPDX-License-Identifier: Apache-2.0
//
// stamp-version.mjs — set the app version across the source tree.
//
// The app version is declared in three coupled places:
//   1. src/local/main.js   — `const VERSION = 'X.Y.Z';` (single source of truth at runtime)
//   2. src/local/app.html  — every `?v=X.Y.Z` cache-bust query string on <script>/<img>
//
// Releasing means bumping all of them together so the browser actually reloads
// the new assets. This script does that deterministically and idempotently:
// running it twice with the same version is a no-op.
//
// Usage:
//   node scripts/stamp-version.mjs 3.1.0
//   node scripts/stamp-version.mjs --check        # verify all locations agree, print version
//
// Exit codes: 0 ok; 1 usage/validation error; 2 mismatch in --check mode.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_JS = join(ROOT, 'src', 'local', 'main.js');
const APP_HTML = join(ROOT, 'src', 'local', 'app.html');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_DECL = /(\bconst\s+VERSION\s*=\s*')([^']+)(';)/;
const CACHE_BUST = /(\?v=)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g;

function readVersionFromMain(text) {
  const m = text.match(VERSION_DECL);
  if (!m) throw new Error(`Could not find "const VERSION = '...'" in ${MAIN_JS}`);
  return m[2];
}

function check() {
  const mainText = readFileSync(MAIN_JS, 'utf8');
  const htmlText = readFileSync(APP_HTML, 'utf8');
  const version = readVersionFromMain(mainText);

  const bustVersions = new Set();
  for (const m of htmlText.matchAll(CACHE_BUST)) bustVersions.add(m[2]);

  const mismatches = [...bustVersions].filter(v => v !== version);
  if (mismatches.length) {
    console.error(`Version mismatch. main.js=${version}, app.html cache-busts=${[...bustVersions].join(', ')}`);
    process.exit(2);
  }
  console.log(version);
  return version;
}

function stamp(version) {
  if (!SEMVER.test(version)) {
    console.error(`Invalid version "${version}". Expected semver like 3.1.0 or 3.1.0-rc.1`);
    process.exit(1);
  }

  // main.js
  const mainText = readFileSync(MAIN_JS, 'utf8');
  if (!VERSION_DECL.test(mainText)) {
    console.error(`Could not find VERSION declaration in ${MAIN_JS}`);
    process.exit(1);
  }
  const newMain = mainText.replace(VERSION_DECL, `$1${version}$3`);
  if (newMain !== mainText) writeFileSync(MAIN_JS, newMain);

  // app.html cache-bust query strings
  const htmlText = readFileSync(APP_HTML, 'utf8');
  let count = 0;
  const newHtml = htmlText.replace(CACHE_BUST, (_all, prefix) => { count++; return `${prefix}${version}`; });
  if (newHtml !== htmlText) writeFileSync(APP_HTML, newHtml);

  console.log(`Stamped version ${version} (main.js + ${count} cache-bust refs in app.html)`);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/stamp-version.mjs <version> | --check');
  process.exit(1);
} else if (arg === '--check') {
  check();
} else {
  stamp(arg.replace(/^v/, ''));
}
