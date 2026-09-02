// SPDX-License-Identifier: Apache-2.0
//
// Discussion names vs. file stems (dev.11). Files are named by the sanitized
// stem ([A-Za-z0-9_ -]), so "R&D" and "RD" both map to RD.md. create/rename
// must be unique on the STEM, not only on the display name, or one discussion
// silently overwrites another's file. IO is mocked; "disk" is keyed by stem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/local/io.js';
import { store } from './_load.mjs';

const io = globalThis.Chippy.io;
const real = { renameDiscussion: io.renameDiscussion };
const disk = new Map(); // stem -> member ("the .md files")
const stem = n => io.sanitizeName(n);

function seed() {
  disk.clear();
  disk.set('RD', { name: 'RD', prep: '', entries: [
    { created_at: '2026-09-02 09:00:00', tags: [], goal: null, due: null, body: 'Keep me.' }
  ] });
  disk.set('Alpha', { name: 'Alpha', prep: '', entries: [] });
  const s = store._state;
  s.dirHandle = {}; s.folderReady = true;
  s.nav = { theme: 'dark', discussions: [
    { name: 'RD', tag: null, favorite: false, archived: false, sensitive: false },
    { name: 'Alpha', tag: null, favorite: false, archived: false, sensitive: false }
  ] };
  s.tags = []; s.names = [];
  s.members = new Map([['RD', null], ['Alpha', null]]);
  s.activeMemberName = null;
}
io.loadDiscussion = async (_d, name) => {
  const m = disk.get(stem(name));
  if (!m) throw new Error('not on disk: ' + name);
  return { name: m.name, prep: m.prep, entries: m.entries.map(e => ({ ...e })) };
};
io.saveDiscussion = async (_d, m) => { disk.set(stem(m.name), { ...m, entries: [...m.entries] }); };
io.renameDiscussion = async (_d, oldName, newName) => {
  const m = disk.get(stem(oldName)); disk.delete(stem(oldName));
  disk.set(stem(newName), { ...m, name: newName });
};
io.saveNav = async () => {}; io.saveTags = async () => {}; io.saveNames = async () => {};

test.after(() => { io.renameDiscussion = real.renameDiscussion; });

test('createDiscussion: a display name whose stem collides gets a suffix instead of overwriting', async () => {
  seed();
  await store.createDiscussion('R&D');            // stem "RD" is taken by "RD"
  assert.equal(disk.get('RD').entries[0].body, 'Keep me.', 'RD.md untouched');
  assert.ok(store.getDiscussions().some(d => d.name === 'R&D_2'), 'created as R&D_2');
  assert.ok(disk.has('RD_2'), 'written to RD_2.md');
});

test('createDiscussion: a name with no filename characters is rejected', async () => {
  seed();
  await assert.rejects(() => store.createDiscussion('&&&'), /no usable filename characters/);
  assert.equal(disk.size, 2);
});

test('renameDiscussion: refuses a new name whose stem belongs to another discussion', async () => {
  seed();
  await assert.rejects(() => store.renameDiscussion('Alpha', 'R&D'), /same file \(RD\.md\)/);
  assert.equal(disk.get('RD').entries[0].body, 'Keep me.');
  assert.ok(disk.has('Alpha'), 'Alpha.md still there');
  assert.ok(store.getDiscussions().some(d => d.name === 'Alpha'));
});

test('renameDiscussion: same-stem rename keeps the file and rewrites its title', async () => {
  seed();
  await store.renameDiscussion('RD', 'R&D');       // stem unchanged: RD.md
  assert.equal(disk.size, 2, 'no new file');
  assert.equal(disk.get('RD').name, 'R&D', 'title line updated in the file');
  assert.equal(disk.get('RD').entries[0].body, 'Keep me.');
  assert.ok(store.getDiscussions().some(d => d.name === 'R&D'));
  assert.ok(!store.getDiscussions().some(d => d.name === 'RD'));
});

test('renameDiscussion: a plain rename to a free stem still works', async () => {
  seed();
  await store.renameDiscussion('Alpha', 'Beta');
  assert.ok(disk.has('Beta') && !disk.has('Alpha'));
  assert.ok(store.getDiscussions().some(d => d.name === 'Beta'));
});
