// SPDX-License-Identifier: Apache-2.0
//
// Node seeding harness — runs the app's real store write-path over the dataset
// without a browser, by backing a minimal FileSystemDirectoryHandle with the
// Node filesystem. Two uses:
//   1. Verification: prove the dataset + store actions produce spec-valid files
//      (validated by the Phase 4 validator) and capture a deterministic golden.
//   2. Fallback generator if a pure-disk dataset is ever needed.
//
// It loads the app's classic scripts for side-effect (globalThis.Chippy) and
// drives them with the same window.__chippyTest hooks the browser path uses, so
// the output matches the in-browser seed byte-for-byte (run under TZ=UTC).

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from './seeded-rng.mjs';
import { createSkeleton } from './init-folder.mjs';
import { DATASET, DISCUSSION_NAMES, runDriver } from './dataset.mjs';

/* -- minimal Node-backed FileSystemDirectoryHandle (subset io.js uses) -- */

class NodeWritable {
  constructor(path) { this.path = path; this.chunks = []; }
  async write(data) { this.chunks.push(data); }
  async close() {
    const first = this.chunks[0];
    if (typeof first === 'string') writeFileSync(this.path, this.chunks.join(''));
    else {
      const bufs = await Promise.all(this.chunks.map(async c =>
        Buffer.from(c instanceof Uint8Array ? c : await c.arrayBuffer())));
      writeFileSync(this.path, Buffer.concat(bufs));
    }
  }
}
class NodeFileHandle {
  constructor(path) { this.kind = 'file'; this.path = path; }
  async getFile() {
    const p = this.path;
    return { async text() { return readFileSync(p, 'utf8'); },
             async arrayBuffer() { return readFileSync(p); } };
  }
  async createWritable() { return new NodeWritable(this.path); }
}
class NodeDirHandle {
  constructor(path) { this.kind = 'directory'; this.path = path; }
  async getFileHandle(name, opts = {}) {
    const p = join(this.path, name);
    if (!existsSync(p) && !opts.create) { const e = new Error('NotFound: ' + name); e.name = 'NotFoundError'; throw e; }
    if (opts.create && !existsSync(p)) writeFileSync(p, '');
    return new NodeFileHandle(p);
  }
  async getDirectoryHandle(name, opts = {}) {
    const p = join(this.path, name);
    if (!existsSync(p)) { if (!opts.create) { const e = new Error('NotFound dir'); e.name = 'NotFoundError'; throw e; } mkdirSync(p, { recursive: true }); }
    return new NodeDirHandle(p);
  }
  async removeEntry(name, opts = {}) { rmSync(join(this.path, name), { recursive: !!opts.recursive, force: true }); }
  async *entries() {
    const { readdirSync, statSync } = await import('node:fs');
    for (const n of readdirSync(this.path)) {
      const kind = statSync(join(this.path, n)).isDirectory() ? 'directory' : 'file';
      yield [n, kind === 'directory' ? new NodeDirHandle(join(this.path, n)) : new NodeFileHandle(join(this.path, n))];
    }
  }
}

/* ------------------------------- runner ------------------------------- */

export async function runNodeSeed(dir, { epochMs = Date.UTC(2026, 0, 5, 9, 0, 0), rngSeed = 0xC419CD } = {}) {
  rmSync(dir, { recursive: true, force: true });
  createSkeleton(dir, DISCUSSION_NAMES);

  // Load app scripts for side-effect (format -> io -> store), once.
  await import('../../../../src/local/format.js');
  await import('../../../../src/local/io.js');
  await import('../../../../src/local/store.js');
  const store = globalThis.Chippy.store;

  let t = epochMs;
  const rng = mulberry32(rngSeed);
  globalThis.__chippyTest = {
    dirHandle: new NodeDirHandle(dir),
    now: () => { const d = new Date(t); t += 60000; return d; },
    rng
  };

  await store.openFolder();
  const summary = await runDriver(DATASET, store);
  return summary;
}

// Standalone:  TZ=UTC node tests/local/e2e/fixtures/node-seed.mjs [dir]
if (process.argv[1] && process.argv[1].endsWith('node-seed.mjs')) {
  const dir = process.argv[2] ?? join(process.cwd(), 'tests', 'local', '.tmp', 'seed');
  const s = await runNodeSeed(dir);
  console.log(`node-seed: ${s.discussions} discussions, ${s.entries} entries -> ${dir}`);
}
