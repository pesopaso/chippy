// SPDX-License-Identifier: Apache-2.0
//
// reloadFolder — re-reads the whole folder without the picker: fresh indexes,
// nav reconciled with the files on disk, member cache reloaded. For folders
// that other tools (e.g. an AI) write to while Chippy is open. IO is mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/local/io.js';
import { store } from './_load.mjs';

const io = globalThis.Chippy.io;
const disk = new Map();      // name -> member object ("the files")
let diskNav = null;          // "navigation.chippy.md"

function seed() {
  disk.clear();
  disk.set('Maria', { name: 'Maria', prep: '', entries: [
    { created_at: '2026-08-27 09:00:00', tags: ['task'], goal: null, due: null, body: 'Original task.' }
  ] });
  diskNav = { theme: 'dark', discussions: [
    { name: 'Maria', tag: null, favorite: false, archived: false, sensitive: false }
  ] };
  const s = store._state;
  s.dirHandle = {}; s.folderReady = true;
  s.nav = { theme: 'dark', discussions: [...diskNav.discussions.map(d => ({ ...d }))] };
  s.tags = []; s.names = [];
  s.members = new Map([['Maria', { name: 'Maria', prep: '', entries: [...disk.get('Maria').entries] }]]);
  s.activeMemberName = 'Maria';
}
io.loadIndexes = async () => ({ nav: { theme: diskNav.theme, discussions: diskNav.discussions.map(d => ({ ...d })) }, tags: [], names: [] });
io.reconcileNavWithFiles = async (_d, nav) => {
  // disk is the source of truth: add file-backed names missing from nav
  const have = new Set(nav.discussions.map(d => d.name));
  const discussions = nav.discussions.filter(d => disk.has(d.name));
  for (const name of disk.keys()) if (!have.has(name)) discussions.push({ name, tag: null, favorite: false, archived: false, sensitive: false });
  return { nav: { ...nav, discussions }, changed: discussions.length !== nav.discussions.length };
};
io.loadDiscussion = async (_d, name) => {
  if (!disk.has(name)) throw new Error('not on disk: ' + name);
  const m = disk.get(name);
  return { name: m.name, prep: m.prep, entries: m.entries.map(e => ({ ...e })) };
};
io.saveNav = async () => {}; io.saveTags = async () => {}; io.saveNames = async () => {};
io.saveDiscussion = async (_d, m) => { disk.set(m.name, m); };

test('reloadFolder picks up a discussion created outside Chippy', async () => {
  seed();
  disk.set('AI Notes', { name: 'AI Notes', prep: '', entries: [
    { created_at: '2026-08-27 10:00:00', tags: [], goal: null, due: null, body: 'Written by the AI.' }
  ] });
  let evt = null;
  const un = store.subscribe(cs => { if (cs.type === 'folderReloaded') evt = cs; });
  await store.reloadFolder();
  un();
  assert.ok(store._state.nav.discussions.some(d => d.name === 'AI Notes'), 'new discussion in nav');
  assert.equal(store.getMember('AI Notes').entries[0].body, 'Written by the AI.');
  assert.equal(evt.discussions, 2);
});

test('reloadFolder refreshes outside edits to an existing discussion', async () => {
  seed();
  disk.get('Maria').entries.push(
    { created_at: '2026-08-27 11:00:00', tags: ['task', 'high'], goal: null, due: null, body: 'Added by the AI.' });
  await store.reloadFolder();
  const m = store.getMember('Maria');
  assert.equal(m.entries.length, 2, 'cache was reloaded from disk');
  assert.equal(m.entries[1].body, 'Added by the AI.');
});

test('reloadFolder clears the active member when its file is gone', async () => {
  seed();
  disk.delete('Maria');
  await store.reloadFolder();
  assert.equal(store._state.activeMemberName, null);
  assert.ok(!store._state.nav.discussions.some(d => d.name === 'Maria'));
});

test('reloadFolder is a no-op before a folder is open', async () => {
  store._state.folderReady = false;
  store._state.dirHandle = null;
  await store.reloadFolder(); // must not throw
  assert.ok(true);
});
