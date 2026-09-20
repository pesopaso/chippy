// SPDX-License-Identifier: Apache-2.0
//
// The Realized idea state (realizedidea): an idea that was done in reality
// without (necessarily) becoming a task or goal in the notebook. Settled like
// Promoted/Shelved: not "open", reserved tag, transition logged.

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
  s.nav = { theme: 'dark', discussions: [{ name: 'Team', tag: null, favorite: false, archived: false, sensitive: false }] };
  s.members = new Map([['Team', { name: 'Team', prep: '', entries: [
    { created_at: '2026-09-19 09:00:00', tags: ['idea', 'exploredidea'], goal: null, due: null, body: 'Great idea.' }
  ] }]]);
  s.activeMemberName = 'Team';
}

test('realizedidea is a reserved tag', () => {
  assert.equal(globalThis.Chippy.tags.isReserved('realizedidea'), true);
});

test('updateIdeaState to realized: tag swap + "→ Realized" action bullet', async () => {
  seed();
  await store.updateIdeaState('Team', '2026-09-19 09:00:00', 'realized', 0);
  const e = store._state.members.get('Team').entries[0];
  assert.ok(e.tags.includes('realizedidea'));
  assert.ok(!e.tags.includes('exploredidea'));
  assert.match(e.body, /^- \d{4}-\d{2}-\d{2} : → Realized$/m);
  assert.equal(store.getOpenIdeas({ entries: [e] }).length, 0); // settled
});

test('realized is reversible: back to considered strips the tag', async () => {
  seed();
  await store.updateIdeaState('Team', '2026-09-19 09:00:00', 'realized', 0);
  await store.updateIdeaState('Team', '2026-09-19 09:00:00', 'considered', 0);
  const e = store._state.members.get('Team').entries[0];
  assert.ok(!e.tags.includes('realizedidea'));
  assert.equal(store.getOpenIdeas({ entries: [e] }).length, 1);
});
