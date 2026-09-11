// SPDX-License-Identifier: Apache-2.0
//
// removeName — deleting an UNUSED name (0 mentions) from names.chippy.md.
// The store re-checks every loaded entry body before writing: a name still
// @-mentioned anywhere is refused, so the Names page's 🗑 (offered only at
// 0 mentions) can never lose a live name. IO is mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/local/io.js';
import { store } from './_load.mjs';

const io = globalThis.Chippy.io;
let savedNames = null; // captures what removeName writes to "names.chippy.md"
io.saveNames = async (_dir, names) => { savedNames = names.slice(); };

function seed() {
  savedNames = null;
  const s = store._state;
  s.dirHandle = {}; s.folderReady = true;
  s.tags = [];
  s.names = ['Ghost Person', 'Maria Lopez'];
  s.nav = { theme: 'dark', discussions: [
    { name: 'Team', tag: null, favorite: false, archived: false, sensitive: false }
  ] };
  // One discussion, fully loaded; only Maria is mentioned.
  s.members = new Map([['Team', { name: 'Team', prep: '', entries: [
    { created_at: '2026-09-10 09:00:00', tags: [], goal: null, due: null, body: 'Sync with @[Maria Lopez] tomorrow.' }
  ] }]]);
  s.activeMemberName = 'Team';
}

test('an unused name is removed and names.chippy.md saved', async () => {
  seed();
  const ok = await store.removeName('Ghost Person');
  assert.equal(ok, true);
  assert.deepEqual(store._state.names, ['Maria Lopez']);
  assert.deepEqual(savedNames, ['Maria Lopez']);
});

test('a name that is still mentioned is refused and nothing is written', async () => {
  seed();
  const ok = await store.removeName('Maria Lopez');
  assert.equal(ok, false);
  assert.deepEqual(store._state.names, ['Ghost Person', 'Maria Lopez']);
  assert.equal(savedNames, null);
});

test('an unknown name returns false without writing', async () => {
  seed();
  const ok = await store.removeName('Nobody Here');
  assert.equal(ok, false);
  assert.equal(savedNames, null);
});

test('removal emits nameRemoved with the name', async () => {
  seed();
  const events = [];
  const unsub = store.subscribe(e => events.push(e));
  await store.removeName('Ghost Person');
  if (typeof unsub === 'function') unsub();
  const ev = events.find(e => e.type === 'nameRemoved');
  assert.ok(ev, 'nameRemoved emitted');
  assert.equal(ev.name, 'Ghost Person');
});
