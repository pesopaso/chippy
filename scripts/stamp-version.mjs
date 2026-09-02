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
// Rule (see documentation/changelog.md, "Format"): every changelog entry is a
// version update. The newest `### vX.Y.Z[-dev.N]` heading in the changelog must
// never be AHEAD of the stamp — a changelog entry without a stamp means the
// browser keeps serving cached assets for a change that already shipped.
// --check enforces this; --sync stamps the newest changelog version in one go.
// (The stamp may be ahead of the changelog: the release workflow bumps main to
// X.Y.0 and staging to X.(Y+1).0-dev.1 before any entry exists for them.)
//
// Usage:
//   node scripts/stamp-version.mjs 3.1.0
//   node scripts/stamp-version.mjs --check        # locations agree AND stamp >= newest changelog entry; print version
//   node scripts/stamp-version.mjs --sync         # stamp the newest changelog version (no-op when already there)
//
// Exit codes: 0 ok; 1 usage/validation error; 2 mismatch in --check mode.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_JS = join(ROOT, 'src', 'local', 'main.js');
const APP_HTML = join(ROOT, 'src', 'local', 'app.html');
const CHANGELOG = join(ROOT, 'documentation', 'changelog.md');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_DECL = /(\bconst\s+VERSION\s*=\s*')([^']+)(';)/;
const CACHE_BUST = /(\?v=)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g;

// Order versions: X.Y.Z-dev.N < X.Y.Z (a release outranks every dev build of it).
function versionKey(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? Infinity : Number(m[4])];
}
function compareVersions(a, b) {
  const ka = versionKey(a), kb = versionKey(b);
  if (!ka || !kb) return 0; // non-dev prereleases (rc etc.) are not ordered here
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

// The newest `### vX.Y.Z[-dev.N]` heading anywhere in the changelog (entries are
// appended chronologically, but the Released section sits at the top, so take
// the maximum rather than the last).
function newestChangelogVersion() {
  let text;
  try { text = readFileSync(CHANGELOG, 'utf8'); } catch (_) { return null; }
  let best = null;
  for (const m of text.matchAll(/^### v(\d+\.\d+\.\d+(?:-dev\.\d+)?)\b/gm)) {
    if (!best || compareVersions(m[1], best) > 0) best = m[1];
  }
  return best;
}

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

  // Changelog rule: the newest changelog entry must not be ahead of the stamp.
  const newest = newestChangelogVersion();
  if (newest && compareVersions(newest, version) > 0) {
    console.error(`Version behind changelog. Stamp is ${version} but documentation/changelog.md has an entry for v${newest}.\n` +
                  `Every changelog entry is a version update: run "node scripts/stamp-version.mjs --sync" (or stamp ${newest}).`);
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
  console.error('Usage: node scripts/stamp-version.mjs <version> | --check | --sync');
  process.exit(1);
} else if (arg === '--check') {
  check();
} else if (arg === '--sync') {
  const newest = newestChangelogVersion();
  if (!newest) { console.error('No "### vX.Y.Z" heading found in documentation/changelog.md'); process.exit(1); }
  const current = readVersionFromMain(readFileSync(MAIN_JS, 'utf8'));
  if (compareVersions(newest, current) < 0) {
    console.log(`Stamp ${current} is already ahead of the newest changelog entry (v${newest}); nothing to do.`);
  } else {
    stamp(newest);
  }
  check();
} else {
  stamp(arg.replace(/^v/, ''));
}
