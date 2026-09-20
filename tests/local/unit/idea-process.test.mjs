// SPDX-License-Identifier: Apache-2.0
//
// Idea process rules (v3.3.0-dev.35): linked tasks can be created from the
// Explored state on (the first task promotes the idea); goals only from an
// already Promoted idea; Considered creates nothing yet; Realized/Shelved are
// the closed states. store.promoteIdea enforces this, mirroring the badge
// dropdown's gating. IO is mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/local/io.js';
import { store } from './_load.mjs';

const io = globalThis.Chippy.io;
io.saveDiscussion = async () => {};
io.saveTags = async () => {};

function seed(stateTag) {
  const s = store._state;
  s.dirHandle = {}; s.folderReady = true;
  s.tags = []; s.names = [];
  s.nav = { theme: 'dark', discussions: [{ name: 'Team', tag: null, favorite: false, archived: false, sensitive: false }] };
  const tags = ['idea']; if (stateTag) tags.push(stateTag);
  s.members = new Map([['Team', { name: 'Team', prep: '', entries: [
    { created_at: '2026-09-19 09:00:00', tags, goal: null, due: null, body: 'Big idea.' }
  ] }]]);
  s.activeMemberName = 'Team';
}
const idea = () => store._state.members.get('Team').entries[0];

test('explored idea + task: allowed, idea becomes Promoted', async () => {
  seed('exploredidea');
  const created = await store.promoteIdea('Team', '2026-09-19 09:00:00', 'task', 'Build it', 0);
  assert.ok(created, 'task created');
  assert.ok(created.tags.includes('task'));
  assert.ok(idea().tags.includes('promoteditea'));
});

test('explored idea + goal: refused (goals only from Promoted)', async () => {
  seed('exploredidea');
  const created = await store.promoteIdea('Team', '2026-09-19 09:00:00', 'goal', 'Reach it', 0);
  assert.equal(created, null);
  assert.ok(!idea().tags.includes('promoteditea'), 'state unchanged');
});

test('promoted idea: both task and goal creation allowed, stays Promoted', async () => {
  seed('promoteditea');
  const t = await store.promoteIdea('Team', '2026-09-19 09:00:00', 'task', 'Another task', 0);
  assert.ok(t);
  const g = await store.promoteIdea('Team', '2026-09-19 09:00:00', 'goal', 'A goal', 0);
  assert.ok(g);
  assert.ok(g.tags.includes('goal'));
  assert.ok(idea().tags.includes('promoteditea'));
});

test('considered idea: neither task nor goal creation allowed', async () => {
  seed(null);
  assert.equal(await store.promoteIdea('Team', '2026-09-19 09:00:00', 'task', 'Nope', 0), null);
  assert.equal(await store.promoteIdea('Team', '2026-09-19 09:00:00', 'goal', 'Nope', 0), null);
});

test('closed states create nothing', async () => {
  for (const st of ['realizedidea', 'shelvedidea']) {
    seed(st);
    assert.equal(await store.promoteIdea('Team', '2026-09-19 09:00:00', 'task', 'Nope', 0), null, st);
  }
});
