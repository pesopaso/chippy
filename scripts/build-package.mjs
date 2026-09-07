// SPDX-License-Identifier: Apache-2.0
//
// build-package.mjs — assemble the distributable chippy.zip.
//
// Contents (everything an end user needs to run the app with sample data):
//   chippy/                       top-level folder inside the zip
//     START-HERE.txt              one-page quickstart (generated)
//     README.md                   project readme
//     THIRD-PARTY-NOTICES.md      vendored DOMPurify notice
//     LICENSE, NOTICE             Apache-2.0 license + attribution
//     app/                        the application — serve this folder and open app.html
//       app.html, *.js, style.css, chippy-icon.svg, dompurify.min.js, serve.cmd
//     demo-notebook/              ready-to-open sample data folder
//     introduction-notebook/      guided introduction notebook (open as your first folder)
//
// Excluded from the app folder: editor backups (*.bak) and the in-page test
// harness (__wtest.js) — dev-only, never shipped.
//
// The archive is written with a pure-Node ZIP writer (no external `zip` binary,
// no npm deps), so it runs identically on CI (Linux) and Windows. Output is
// deterministic: fixed entry timestamps mean the same inputs produce the same
// bytes.
//
// Usage:
//   node scripts/build-package.mjs                 # -> dist/chippy.zip
//   node scripts/build-package.mjs --out dist      # choose output dir
//   node scripts/build-package.mjs --versioned     # also write chippy-<version>.zip

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync
} from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(ROOT, 'src', 'local');
const DEMO_DIR = join(ROOT, 'regressionharness', 'referencedata');
const INTRO_DIR = join(ROOT, 'documentation', 'introduction-template');
const TOP = 'chippy'; // top-level folder inside the zip

// ---- args ----
const args = process.argv.slice(2);
let outDir = join(ROOT, 'dist');
let versioned = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = join(ROOT, args[++i]);
  else if (args[i] === '--versioned') versioned = true;
}

// ---- version (read from the single source of truth) ----
function appVersion() {
  const main = readFileSync(join(APP_DIR, 'main.js'), 'utf8');
  const m = main.match(/\bconst\s+VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('Could not read VERSION from src/local/main.js');
  return m[1];
}

// ---- collect files: [{ archivePath, absPath }] ----
const EXCLUDE_APP = (name) => name.endsWith('.bak') || name === '__wtest.js';
// Shipped at the package root instead of inside app/:
const ROOT_DOCS = new Set(['README.md', 'THIRD-PARTY-NOTICES.md']);

function walk(absRoot, archiveBase, filterName = () => true) {
  const out = [];
  for (const name of readdirSync(absRoot)) {
    const abs = join(absRoot, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walk(abs, `${archiveBase}/${name}`, filterName));
    } else if (filterName(name)) {
      out.push({ archivePath: `${archiveBase}/${name}`, absPath: abs });
    }
  }
  return out;
}

function startHere(version) {
  return [
    `Chippy v${version}`,
    '====================',
    '',
    'A local, single-user web tool for staying on top of long-running discussions.',
    'Everything stays on your machine — no server, no build, no accounts.',
    '',
    'QUICK START',
    '-----------',
    '1. Use a Chromium browser (Chrome or Edge) — the app needs the File System',
    '   Access API.',
    '2. Open the app — either way works:',
    '     - Directly: double-click  app/app.html  (or drag it into the browser).',
    '     - Via a local server:',
    '         - Windows: double-click  app/serve.cmd',
    '         - macOS/Linux:  run  `python3 -m http.server 8000`  in the app/',
    '           folder, then open  http://localhost:8000/app.html',
    '3. When the app asks for a folder, pick the included  introduction-notebook/',
    '   folder for a guided tour, or  demo-notebook/  to explore sample',
    '   discussions, tasks, and goals. To start your own notebook, pick any',
    '   empty folder instead.',
    '4. Optional: connect your notebook folder to your local AI capabilities',
    '   (e.g. Claude, or another agent with file access) to interact agentically',
    '   with your personal notes, tasks, ideas, and goals — everything is plain',
    '   Markdown, so agents can read and write it directly.',
    '',
    'WHAT IS IN THIS PACKAGE',
    '-----------------------',
    '  app/                          the application (open app.html)',
    '  demo-notebook/                ready-to-open sample data',
    '  introduction-notebook/        guided introduction to Chippy — a good starting',
    '                                point for your own notebook',
    '  README.md                     project readme',
    '  LICENSE, NOTICE               Apache-2.0 license and attribution',
    '  THIRD-PARTY-NOTICES.md        vendored DOMPurify notice',
    '',
    'Your data is plain Markdown files in the folder you choose. Back it up like',
    'any other documents.',
    ''
  ].join('\n');
}

// ---- minimal, dependency-free ZIP writer (deflate) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Fixed timestamp -> reproducible archives (1980-01-01 00:00:00, the ZIP epoch).
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // (year-1980=0)<<9 | month<<5 | day

function zipSync(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.archivePath, 'utf8');
    const data = e.data;
    const crc = crc32(data);
    let method = 8;
    let comp = deflateRawSync(data, { level: 9 });
    if (comp.length >= data.length) { method = 0; comp = data; } // store if no win

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);          // extra len
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0, 8);           // flags
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);          // extra len
    ch.writeUInt16LE(0, 32);          // comment len
    ch.writeUInt16LE(0, 34);          // disk start
    ch.writeUInt16LE(0, 36);          // internal attrs
    ch.writeUInt32LE(0, 38);          // external attrs
    ch.writeUInt32LE(offset, 42);     // local header offset
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localPart, centralPart, eocd]);
}

// ---- assemble ----
const version = appVersion();

const fileEntries = [
  ...walk(APP_DIR, `${TOP}/app`, (name) => !EXCLUDE_APP(name) && !ROOT_DOCS.has(name)),
  ...walk(DEMO_DIR, `${TOP}/demo-notebook`),
  ...walk(INTRO_DIR, `${TOP}/introduction-notebook`),
  { archivePath: `${TOP}/README.md`, absPath: join(APP_DIR, 'README.md') },
  { archivePath: `${TOP}/THIRD-PARTY-NOTICES.md`, absPath: join(APP_DIR, 'THIRD-PARTY-NOTICES.md') },
  { archivePath: `${TOP}/LICENSE`, absPath: join(ROOT, 'LICENSE') },
  { archivePath: `${TOP}/NOTICE`, absPath: join(ROOT, 'NOTICE') }
];

// Read file bytes; inject the generated START-HERE.txt.
const entries = fileEntries.map(e => ({ archivePath: e.archivePath, data: readFileSync(e.absPath) }));
entries.push({ archivePath: `${TOP}/START-HERE.txt`, data: Buffer.from(startHere(version), 'utf8') });
entries.sort((a, b) => a.archivePath.localeCompare(b.archivePath)); // stable ordering

const zip = zipSync(entries);

mkdirSync(outDir, { recursive: true });
const mainOut = join(outDir, 'chippy.zip');
writeFileSync(mainOut, zip);
if (versioned) writeFileSync(join(outDir, `chippy-${version}.zip`), zip);

const kb = (zip.length / 1024).toFixed(1);
console.log(`Built ${relative(ROOT, mainOut).split(sep).join('/')} — v${version}, ${entries.length} files, ${kb} KB`);
for (const e of entries) console.log(`  ${e.archivePath}`);
