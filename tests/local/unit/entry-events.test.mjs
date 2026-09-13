// SPDX-License-Identifier: Apache-2.0
//
// Per-entry mutation events must carry the entry's exact index (idx) besides
// its created_at: created_at alone is NOT unique (legacy minute-precision
// headers), and the targeted single-card refresh needs the index to update
// the right card when two entries share a timestamp. IO is mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/local/io.js';
import { store } from './_load.mjs';

const io = globalThis.Chippy.io;
io.saveDiscussion = async () => {};
io.saveTags = async () => {};

function seed() {
  const s = store._state;
  s.dirHandle = {}; s.folderReady = true;
  s.tags = []; s.names = [];
  s.nav = { theme: 'dark', discussions: [
    { name: 'Team', tag: null, favorite: false, archived: false, sensitive: false }
  ] };
  // Two entries SHARING a legacy minute-precision timestamp + one unique.
  s.members = new Map([['Team', { name: 'Team', prep: '', entries: [
    { created_at: '2026-03-10 09:15', tags: [], goal: null, due: null, body: 'First twin.' },
    { created_at: '2026-03-10 09:15', tags: [], goal: null, due: null, body: 'Second twin.' },
    { created_at: '2026-09-10 09:00:00', tags: ['task'], goal: null, due: null, body: 'Recent task.' }
  ] }]]);
  s.activeMemberName = 'Team';
}

test('editEntry on the second twin edits IT and emits its exact idx', async () => {
  seed();
  const events = [];
  const un = store.subscribe(e => events.push(e));
  await store.editEntry('Team', '2026-03-10 09:15', { text: 'Second twin EDITED.' }, 1);
  if (typeof un === 'function') un();
  const es = store._state.members.get('Team').entries;
  assert.equal(es[0].body, 'First twin.');            // untouched
  assert.match(es[1].body, /^Second twin EDITED\./);  // the one addressed by idx
  const ev = events.find(e => e.type === 'entryEdited');
  assert.ok(ev, 'entryEdited emitted');
  assert.equal(ev.idx, 1);
  assert.equal(ev.entryId, '2026-03-10 09:15');
});

test('other per-entry mutations also carry idx (due, sensitive)', async () => {
  seed();
  const events = [];
  const un = store.subscribe(e => events.push(e));
  await store.setDue('Team', '2026-09-10 09:00:00', '2026-09-20', 2);
  await store.toggleSensitiveEntry('Team', '2026-03-10 09:15', 0);
  if (typeof un === 'function') un();
  assert.equal(events.find(e => e.type === 'dueChanged')?.idx, 2);
  assert.equal(events.find(e => e.type === 'sensitiveToggled')?.idx, 0);
});
