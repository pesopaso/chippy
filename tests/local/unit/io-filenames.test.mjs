// SPDX-License-Identifier: Apache-2.0
//
// Unit tests — the *.chippy.md discussion filename layout (v3.3.0-dev.37):
// filename classification, the folder-open sweep that renames pre-dev.37
// "<stem>.md" / "<stem>.archive.md" files, and the read/write fallbacks that
// keep a partially migrated folder fully usable. Runs in Node against an
// in-memory fake of the File System Access directory handle.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../../../src/local/format.js';
import '../../../src/local/io.js';

const io = globalThis.Chippy.io;
const fmt = globalThis.Chippy.format;

// FSA fake over a name -> text map. `failing` lists names whose read throws
// (simulates an unmaterialized cloud placeholder).
function fakeDir(files, failing = []) {
  const store = new Map(Object.entries(files));
  const bad = new Set(failing);
  return {
    files: store,
    async getFileHandle(name, opts) {
      if (!store.has(name)) {
        if (opts && opts.create) store.set(name, '');
        else { const e = new Error(name + ' not found'); e.name = 'NotFoundError'; throw e; }
      }
      return {
        async getFile() {
          if (bad.has(name)) throw new Error('cloud placeholder: ' + name);
          return { async text() { return store.get(name); } };
        },
        async createWritable() {
          let buf = '';
          return { async write(t) { buf += t; }, async close() { store.set(name, buf); } };
        }
      };
    },
    async removeEntry(name) {
      if (!store.delete(name)) { const e = new Error(name + ' not found'); e.name = 'NotFoundError'; throw e; }
    },
    async getDirectoryHandle() { throw new Error('no subfolders in this fake'); },
    async *entries() {
      for (const name of [...store.keys()]) yield [name, { kind: 'file' }];
    }
  };
}

const disc = (name, body = 'Hello.') =>
  fmt.serializeDiscussion({ name, entries: [{ created_at: '2026-09-22 10:00', tags: [], body }] });
const keys = dir => [...dir.files.keys()].sort();

test('classifyFilename: kinds and stems', () => {
  const c = io.classifyFilename;
  assert.deepEqual(c('Alice Johnson.chippy.md'), { kind: 'discussion', stem: 'Alice Johnson' });
  assert.deepEqual(c('Alice.archive.chippy.md'), { kind: 'archive', stem: 'Alice' });
  assert.deepEqual(c('navigation.sys.chippy.md'), { kind: 'sys', stem: 'navigation' });
  assert.deepEqual(c('Alice.md'), { kind: 'legacy-discussion', stem: 'Alice' });
  assert.deepEqual(c('Alice.archive.md'), { kind: 'legacy-archive', stem: 'Alice' });
  // system names are ordinary stems in the discussion namespace
  assert.equal(c('tags.chippy.md').kind, 'discussion');
  assert.equal(c('summary.md').kind, 'legacy-discussion');
  // not Chippy's, or not loadable by name (stem would not survive sanitizing)
  for (const f of ['notes.txt', 'foo.bar.md', 'foo.bar.chippy.md', 'R&D.md', '.chippy.md', 'x.meta.chippy.md']) {
    assert.equal(c(f).kind, 'other', f);
  }
  assert.equal(io.discussionFilename('RD'), 'RD.chippy.md');
  assert.equal(io.archiveFilename('RD'), 'RD.archive.chippy.md');
  assert.equal(io.CHIPPY_SUFFIX, '.chippy.md');
  assert.equal(io.SYS_SUFFIX, '.sys.chippy.md');
});

test('sweep: renames <stem>.md and <stem>.archive.md into the .chippy.md layout', async () => {
  const dir = fakeDir({
    'Alpha.md': disc('Alpha'),
    'Beta.archive.md': disc('Beta'),
    'Gamma.chippy.md': disc('Gamma'),
    'navigation.sys.chippy.md': fmt.serializeNav({ discussions: [] }),
    'notes.txt': 'not ours',
    'foo.bar.md': 'never loadable by name'
  });
  const r = await io.migrateDiscussionFilenames(dir);
  assert.deepEqual(r.renamed, [['Alpha.md', 'Alpha.chippy.md'], ['Beta.archive.md', 'Beta.archive.chippy.md']]);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(keys(dir), ['Alpha.chippy.md', 'Beta.archive.chippy.md', 'Gamma.chippy.md',
    'foo.bar.md', 'navigation.sys.chippy.md', 'notes.txt']);
  assert.equal(dir.files.get('Alpha.chippy.md'), disc('Alpha')); // byte-identical
  // idempotent
  const r2 = await io.migrateDiscussionFilenames(dir);
  assert.deepEqual(r2, { renamed: [], skipped: [] });
});

test('sweep: never overwrites — an existing target keeps the old file untouched', async () => {
  const dir = fakeDir({ 'Alpha.md': disc('Alpha', 'old'), 'Alpha.chippy.md': disc('Alpha', 'new') });
  const r = await io.migrateDiscussionFilenames(dir);
  assert.deepEqual(r.renamed, []);
  assert.deepEqual(r.skipped, [['Alpha.md', 'target exists']]);
  assert.equal(dir.files.get('Alpha.chippy.md'), disc('Alpha', 'new'));
  assert.equal(dir.files.get('Alpha.md'), disc('Alpha', 'old'));
});

test('sweep: a file that fails to read is skipped, the rest is migrated, nothing throws', async () => {
  const dir = fakeDir({ 'Alpha.md': disc('Alpha'), 'Beta.md': disc('Beta') }, ['Alpha.md']);
  const r = await io.migrateDiscussionFilenames(dir);
  assert.deepEqual(r.renamed, [['Beta.md', 'Beta.chippy.md']]);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0][0], 'Alpha.md');
  assert.ok(dir.files.has('Alpha.md'), 'unreadable source left in place for the next open');
  assert.ok(!dir.files.has('Alpha.chippy.md') || dir.files.get('Alpha.chippy.md') !== '', 'no empty target left behind');
});

test('sweep runs from loadIndexes, after the system files are in place', async () => {
  const dir = fakeDir({
    'navigation.sys.chippy.md': fmt.serializeNav({ discussions: [{ name: 'Alpha', favorite: false, archived: false, tag: null }] }),
    'Alpha.md': disc('Alpha'),
    'Old.archive.md': disc('Old')
  });
  const { nav } = await io.loadIndexes(dir);
  assert.equal(nav.discussions.length, 1);
  assert.deepEqual(keys(dir), ['Alpha.chippy.md', 'Old.archive.chippy.md', 'navigation.sys.chippy.md']);
  const rec = await io.reconcileNavWithFiles(dir, nav);
  assert.deepEqual(rec.nav.discussions.map(d => [d.name, d.archived]), [['Alpha', false], ['Old', true]]);
});

test('partially migrated folder: legacy files are still listed, loaded, and migrated on save', async () => {
  const dir = fakeDir({ 'Alpha.md': disc('Alpha', 'legacy body'), 'Beta.chippy.md': disc('Beta') });
  assert.deepEqual(await io.listDiscussions(dir), ['Alpha', 'Beta']);
  const m = await io.loadDiscussion(dir, 'Alpha');
  assert.equal(m.entries[0].body, 'legacy body');
  m.entries[0].body = 'edited';
  await io.saveDiscussion(dir, m);
  assert.deepEqual(keys(dir), ['Alpha.chippy.md', 'Beta.chippy.md']);
  assert.ok(dir.files.get('Alpha.chippy.md').includes('edited'));
  // the current file wins when both exist
  dir.files.set('Alpha.md', disc('Alpha', 'stale'));
  assert.deepEqual(await io.listDiscussions(dir), ['Alpha', 'Beta']);
  assert.equal((await io.loadDiscussion(dir, 'Alpha')).entries[0].body, 'edited');
});

test('archive/rename operate on the .chippy.md layout and honour a pending legacy file', async () => {
  const dir = fakeDir({ 'Alpha.chippy.md': disc('Alpha'), 'Beta.md': disc('Beta') });
  await io.archiveDiscussion(dir, 'Alpha');
  assert.deepEqual(keys(dir), ['Alpha.archive.chippy.md', 'Beta.md']);
  assert.deepEqual(await io.listArchived(dir), ['Alpha']);
  // renaming onto a stem whose legacy file still exists is refused
  dir.files.set('Gamma.md', disc('Gamma'));
  await assert.rejects(() => io.renameDiscussion(dir, 'Beta', 'Gamma'), /Cannot rename: Gamma\.chippy\.md already exists/);
  // renaming a legacy file writes the new layout and removes the legacy source
  await io.renameDiscussion(dir, 'Beta', 'Delta');
  assert.deepEqual(keys(dir), ['Alpha.archive.chippy.md', 'Delta.chippy.md', 'Gamma.md']);
  assert.equal(fmt.parseDiscussion(dir.files.get('Delta.chippy.md'), 'Delta.chippy.md').name, 'Delta');
});

test('parseDiscussion: filename fallback strips the .chippy.md / .archive.chippy.md suffix', () => {
  assert.equal(fmt.parseDiscussion('## Entries\n', 'Alpha.chippy.md').name, 'Alpha');
  assert.equal(fmt.parseDiscussion('## Entries\n', 'Alpha.archive.chippy.md').name, 'Alpha');
  assert.equal(fmt.parseDiscussion('## Entries\n', 'Alpha.md').name, 'Alpha');
});
