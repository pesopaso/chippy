// SPDX-License-Identifier: Apache-2.0
//
// Sensitive marker unit tests — the reserved 'sensitive' entry tag, the
// "| sensitive" navigation flag, and the AI-summary exclusion filter
// (store.excludeSensitive). Entries tagged sensitive, and every entry of a
// discussion flagged sensitive, are excluded from automatically created
// summaries. IO is mocked in-memory.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../../../src/local/io.js';
import { store, format } from './_load.mjs';

const tags = globalThis.Chippy.tags;
const io = globalThis.Chippy.io;

/* ------------------------------ taxonomy ------------------------------- */

test("'sensitive' is a reserved tag (hidden from chips and tag counts)", () => {
  assert.ok(tags.isReserved('sensitive'));
  assert.ok(!tags.PROMOTABLE.test('sensitive'), 'stays app-managed, not typeable');
});

/* ------------------------------- format -------------------------------- */

test('navigation round-trips the "| sensitive" flag (with tag/favorite mix)', () => {
  const nav = { theme: 'dark', discussions: [
    { name: 'Maria Lopez', tag: 'Team', favorite: true, archived: false, sensitive: true },
    { name: 'Cloud Migration', tag: null, favorite: false, archived: false, sensitive: false }
  ] };
  const md = format.serializeNav(nav);
  assert.ok(md.includes('- Maria Lopez | tag: Team | favorite | sensitive'));
  assert.ok(md.includes('- Cloud Migration\n'), 'no flag written when off');
  const back = format.parseNav(md);
  assert.equal(back.discussions[0].sensitive, true);
  assert.equal(back.discussions[1].sensitive, false);
  assert.equal(format.serializeNav(back), md, 'byte-identical round-trip');
});

/* ------------------------------- store --------------------------------- */

const saves = [];
function seed() {
  saves.length = 0;
  const s = store._state;
  s.dirHandle = {};
  s.folderReady = true;
  s.nav = { theme: 'dark', discussions: [
    { name: 'Maria Lopez', tag: null, favorite: false, archived: false, sensitive: false },
    { name: 'Cloud Migration', tag: null, favorite: false, archived: false, sensitive: false }
  ] };
  s.tags = []; s.names = [];
  s.members = new Map([
    ['Maria Lopez', { name: 'Maria Lopez', prep: '', entries: [
      { created_at: '2026-08-18 10:00:00', tags: ['task', 'high'], goal: null, due: null, body: 'Public task.' },
      { created_at: '2026-08-18 10:05:00', tags: [], goal: null, due: null, body: 'Salary discussion.' }
    ] }],
    ['Cloud Migration', { name: 'Cloud Migration', prep: '', entries: [
      { created_at: '2026-08-18 11:00:00', tags: ['task'], goal: null, due: null, body: 'Migration task.' }
    ] }]
  ]);
}
io.saveDiscussion = async (_d, m) => { saves.push(m.name); };
io.saveNav = async () => {};
io.saveTags = async () => {};
io.saveNames = async () => {};

test('toggleSensitiveEntry adds and removes the tag, saving the file', async () => {
  seed();
  await store.toggleSensitiveEntry('Maria Lopez', '2026-08-18 10:05:00');
  const e = store._state.members.get('Maria Lopez').entries[1];
  assert.ok(e.tags.includes('sensitive'));
  assert.deepEqual(saves, ['Maria Lopez']);
  await store.toggleSensitiveEntry('Maria Lopez', '2026-08-18 10:05:00');
  assert.ok(!e.tags.includes('sensitive'), 'second toggle unmarks');
});

test('toggleDiscussionSensitive flips the nav flag', async () => {
  seed();
  await store.toggleDiscussionSensitive('Cloud Migration');
  assert.equal(store._state.nav.discussions[1].sensitive, true);
  await store.toggleDiscussionSensitive('Cloud Migration');
  assert.equal(store._state.nav.discussions[1].sensitive, false);
});

test('excludeSensitive drops tagged entries and whole sensitive discussions', async () => {
  seed();
  await store.toggleSensitiveEntry('Maria Lopez', '2026-08-18 10:05:00'); // one comment
  await store.toggleDiscussionSensitive('Cloud Migration');               // one discussion
  const kept = store.excludeSensitive(store.collectEntries());
  assert.equal(kept.length, 1, 'only the public entry survives');
  assert.equal(kept[0].body, 'Public task.');
  // Nothing sensitive leaks even via substring — the filter is tag/flag based.
  assert.ok(kept.every(e => !(e.tags || []).includes('sensitive')));
});

test('excludeSensitive is a no-op when nothing is marked', () => {
  seed();
  const all = store.collectEntries();
  assert.equal(store.excludeSensitive(all).length, all.length);
});
