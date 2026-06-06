// SPDX-License-Identifier: Apache-2.0
//
// OPFS <-> disk bridge.
//
// Headless Chromium can't be handed a real-disk folder without the OS picker, so
// the app's data folder in tests is the browser's Origin Private File System.
// These helpers move the seed folder across that boundary:
//   importDirToOPFS  — push the on-disk skeleton (and any data) into OPFS before
//                      the app opens it.
//   exportOPFSToDir  — pull the app's OPFS output back to disk for Phase 4.
//
// Files cross as base64 over page.evaluate. Subfolders (per-discussion images)
// are preserved. Both helpers run against the OPFS root the app uses as its
// directory handle.

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';

// Walk a disk dir into a flat [{ path, b64 }] list (path is posix-relative).
function collectDisk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = base ? posix.join(base, name) : name;
    if (statSync(abs).isDirectory()) out.push(...collectDisk(abs, rel));
    else out.push({ path: rel, b64: readFileSync(abs).toString('base64') });
  }
  return out;
}

export async function importDirToOPFS(page, dir) {
  const files = collectDisk(dir);
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    const b64ToBytes = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    for (const f of files) {
      const parts = f.path.split('/');
      const fname = parts.pop();
      let dir = root;
      for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create: true });
      const fh = await dir.getFileHandle(fname, { create: true });
      const w = await fh.createWritable();
      await w.write(b64ToBytes(f.b64));
      await w.close();
    }
    return files.length;
  }, files);
  return files.length;
}

export async function exportOPFSToDir(page, dir) {
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const bytesToB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
    const out = [];
    async function walk(handle, base) {
      for await (const [name, h] of handle.entries()) {
        const rel = base ? base + '/' + name : name;
        if (h.kind === 'directory') await walk(h, rel);
        else {
          const file = await h.getFile();
          const buf = new Uint8Array(await file.arrayBuffer());
          out.push({ path: rel, b64: bytesToB64(buf) });
        }
      }
    }
    await walk(root, '');
    return out;
  });

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const parts = f.path.split('/');
    const fname = parts.pop();
    const sub = parts.length ? join(dir, ...parts) : dir;
    if (parts.length) mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, fname), Buffer.from(f.b64, 'base64'));
  }
  return files.length;
}
