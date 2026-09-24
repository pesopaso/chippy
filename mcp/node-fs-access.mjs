// SPDX-License-Identifier: Apache-2.0
//
// node-fs-access.mjs — a minimal File System Access API shim over node:fs.
//
// Chippy's io.js talks to a FileSystemDirectoryHandle (the browser's folder
// picker). This module provides the small subset io.js actually uses —
// getFileHandle / getDirectoryHandle / removeEntry / entries() on directories,
// getFile() / createWritable() on files — backed by a real folder on disk, so
// the unchanged io.js + store.js can run under Node (the MCP server).
//
// Errors mirror the browser's DOMException names (NotFoundError,
// TypeMismatchError, InvalidModificationError) because io.js and store.js only
// ever look at err.name. Writes go to a temp file that is renamed over the
// target, so a crash never leaves a half-written discussion behind.

import fs from 'node:fs/promises';
import path from 'node:path';
import { File } from 'node:buffer'; // global only from Node 20; node:buffer has it since 18.13

function domError(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

function mapError(err, p) {
  if (!err || !err.code) return err;
  if (err.code === 'ENOENT') return domError('NotFoundError', 'Not found: ' + p);
  if (err.code === 'EISDIR' || err.code === 'ENOTDIR') return domError('TypeMismatchError', 'Wrong entry kind: ' + p);
  if (err.code === 'ENOTEMPTY') return domError('InvalidModificationError', 'Directory not empty: ' + p);
  return err;
}

// Handle names are single path segments, exactly like in the browser.
function checkName(name) {
  const n = String(name);
  if (!n || n === '.' || n === '..' || n.includes('/') || n.includes('\\') || n.includes('\0')) {
    throw new TypeError('Invalid entry name: ' + JSON.stringify(name));
  }
  return n;
}

async function toBuffer(data) {
  // FileSystemWritableFileStream.write also accepts { type: 'write', data }.
  if (data && typeof data === 'object' && data.type === 'write' && 'data' in data) data = data.data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  throw new TypeError('Unsupported write data');
}

export class NodeFileHandle {
  constructor(p) {
    this.kind = 'file';
    this.name = path.basename(p);
    this._path = p;
  }

  async getFile() {
    try {
      const [buf, st] = await Promise.all([fs.readFile(this._path), fs.stat(this._path)]);
      return new File([buf], this.name, { lastModified: Math.round(st.mtimeMs) });
    } catch (err) { throw mapError(err, this._path); }
  }

  async createWritable() {
    const target = this._path;
    const chunks = [];
    let closed = false;
    return {
      async write(data) {
        if (closed) throw new TypeError('Stream is closed');
        chunks.push(await toBuffer(data));
      },
      async close() {
        if (closed) return;
        closed = true;
        const buf = Buffer.concat(chunks);
        const tmp = path.join(path.dirname(target), '.' + path.basename(target) + '.' + process.pid + '.tmp');
        try {
          await fs.writeFile(tmp, buf);
          await fs.rename(tmp, target);
        } catch (err) {
          // Sync clients (OneDrive, Dropbox) can briefly lock the target and
          // make the rename fail on Windows — fall back to a direct write.
          await fs.rm(tmp, { force: true }).catch(() => {});
          if (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY') {
            await fs.writeFile(target, buf);
          } else {
            throw mapError(err, target);
          }
        }
      },
      async abort() { closed = true; chunks.length = 0; }
    };
  }

  async isSameEntry(other) { return !!other && other._path === this._path; }
}

export class NodeDirectoryHandle {
  constructor(p) {
    this.kind = 'directory';
    this.name = path.basename(p);
    this._path = path.resolve(p);
  }

  async getFileHandle(name, opts) {
    const p = path.join(this._path, checkName(name));
    try {
      const st = await fs.stat(p);
      if (!st.isFile()) throw domError('TypeMismatchError', 'Not a file: ' + p);
    } catch (err) {
      if (err.code !== 'ENOENT') throw mapError(err, p);
      if (!(opts && opts.create)) throw mapError(err, p);
      try { await fs.writeFile(p, '', { flag: 'wx' }); }
      catch (e2) { if (e2.code !== 'EEXIST') throw mapError(e2, p); }
    }
    return new NodeFileHandle(p);
  }

  async getDirectoryHandle(name, opts) {
    const p = path.join(this._path, checkName(name));
    try {
      const st = await fs.stat(p);
      if (!st.isDirectory()) throw domError('TypeMismatchError', 'Not a directory: ' + p);
    } catch (err) {
      if (err.code !== 'ENOENT') throw mapError(err, p);
      if (!(opts && opts.create)) throw mapError(err, p);
      await fs.mkdir(p, { recursive: true });
    }
    return new NodeDirectoryHandle(p);
  }

  async removeEntry(name, opts) {
    const p = path.join(this._path, checkName(name));
    let st;
    try { st = await fs.stat(p); } catch (err) { throw mapError(err, p); }
    try {
      if (st.isDirectory()) {
        if (opts && opts.recursive) await fs.rm(p, { recursive: true });
        else await fs.rmdir(p);
      } else {
        await fs.unlink(p);
      }
    } catch (err) { throw mapError(err, p); }
  }

  async *entries() {
    let dirents;
    try { dirents = await fs.readdir(this._path, { withFileTypes: true }); }
    catch (err) { throw mapError(err, this._path); }
    for (const d of dirents) {
      if (d.isFile()) yield [d.name, new NodeFileHandle(path.join(this._path, d.name))];
      else if (d.isDirectory()) yield [d.name, new NodeDirectoryHandle(path.join(this._path, d.name))];
    }
  }

  async *keys() { for await (const [k] of this.entries()) yield k; }
  async *values() { for await (const [, v] of this.entries()) yield v; }
  [Symbol.asyncIterator]() { return this.entries(); }

  async isSameEntry(other) { return !!other && other._path === this._path; }

  // Browser folder handles need a permission grant; a Node folder is simply
  // readable/writable (or the fs call fails with a real error).
  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }
}
