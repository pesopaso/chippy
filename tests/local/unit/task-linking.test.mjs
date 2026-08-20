// SPDX-License-Identifier: Apache-2.0
//
// Task-linking unit tests (Phase 1) — the "<origin-stem>:link-<id>" identity
// tag, origin/reference discrimination, connect/disconnect, resolution, and
// stub-skipping in collectEntries. Chippy.io's file calls are mocked
// in-memory; the clock and RNG are pinned via the __chippyTest seam, so every
// minted id is "00000" and every connect timestamp is 2026-08-18 14:05:00.
// (documentation/task-linking-implementation.md)

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.__chippyTest = {
  now: () => new Date(2026, 7, 18, 14, 5, 0), // 2026-08-18 14:05:00
  rng: () => 0                                 // minted ids -> "00000"
};

import '../../../src/local/io.js'; // pure guards (sanitizeName); file IO mocked below
import { store, format } from './_load.mjs';

const tags = globalThis.Chippy.tags;
const io = globalThis.Chippy.io;

/* --------------------------- taxonomy helpers ------------------------- */

test('parseLinkTag splits "<stem>:link-<id>" on the first colon', () => {
  assert.deepEqual(tags.parseLinkTag('Maria Lopez:link-k7f2a'),
    { stem: 'Maria Lopez', id: 'k7f2a' });
  assert.equal(tags.parseLinkTag('muted:2026-01-01'), null);
  assert.equal(tags.parseLinkTag('goal-a1b2c'), null);
  assert.equal(tags.parseLinkTag('link-k7f2a'), null); // no bare form
});

test('link tags are reserved (hidden from chips and tag counts)', () => {
  assert.ok(tags.isReserved('Maria Lopez:link-k7f2a'));
  assert.ok(tags.isReserved('Cloud Migration:link-00000'));
  assert.ok(!tags.isReserved('Maria Lopez'));       // a plain tag with a space
  assert.ok(!tags.isReserved('somename:link-xyz')); // id must be 5 base-36 chars
});

test('linkTagOf finds the link tag among ordinary tags', () => {
  assert.equal(tags.linkTagOf(['task', 'high', 'Cloud Migration:link-ab012']),
    'Cloud Migration:link-ab012');
  assert.equal(tags.linkTagOf(['task', 'high']), null);
  assert.equal(tags.linkTagOf(undefined), null);
});

/* ----------------------------- store fixture -------------------------- */

const saves = [];
const disk = new Map(); // fake on-disk state: name -> member object

function seed() {
  saves.length = 0;
  disk.clear();
  const s = store._state;
  s.dirHandle = {};
  s.folderReady = true;
  s.nav = {
    theme: 'dark',
    discussions: [
      { name: 'Maria Lopez', tag: null, favorite: false, archived: false },
      { name: 'Cloud Migration', tag: null, favorite: false, archived: false }
    ]
  };
  s.tags = []; s.names = [];
  s.members = new Map([
    ['Maria Lopez', { name: 'Maria Lopez', prep: '', entries: [
      { created_at: '2026-08-18 10:30:00', tags: ['task', 'high'], goal: null, due: null,
        body: 'Coordinate the vendor security review.\nMore detail here.' },
      { created_at: '2026-08-18 11:00:00', tags: ['goal', 'goal-aaaaa'], goal: null, due: null,
        body: 'Senior promotion.' }
    ] }],
    ['Cloud Migration', { name: 'Cloud Migration', prep: '', entries: [] }]
  ]);
  for (const [, m] of s.members) disk.set(m.name, m);
}

// In-memory IO over the fake disk: saves are recorded, loads return the stored
// member object, rename moves the disk slot (like the real file rename).
io.saveDiscussion = async (_dir, m) => { disk.set(m.name, m); saves.push(m.name); };
io.saveTags = async () => {};
io.saveNames = async () => {};
io.saveNav = async () => {};
io.loadDiscussion = async (_dir, name) => {
  if (disk.has(name)) return disk.get(name);
  throw new Error('not on disk: ' + name);
};
io.renameDiscussion = async (_dir, oldName, newName) => {
  const m = disk.get(oldName);
  if (m) { disk.delete(oldName); m.name = newName; disk.set(newName, m); }
};

const LT = 'Maria Lopez:link-00000';

/* ------------------------------- connect ------------------------------ */

test('connectToDiscussion mints the id on the origin and appends a reference', async () => {
  seed();
  const lt = await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  assert.equal(lt, LT);

  const origin = store._state.members.get('Maria Lopez').entries[0];
  assert.ok(origin.tags.includes(LT), 'origin gained the link tag');

  const refs = store._state.members.get('Cloud Migration').entries;
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0].tags, ['task', LT]);            // kind + link tag only
  assert.equal(refs[0].created_at, '2026-08-18 14:05:00'); // connect time, not origin time
  assert.equal(refs[0].body, 'Coordinate the vendor security review.'); // cached title
  assert.equal(refs[0].due, null);                          // no state/due on a reference
  assert.deepEqual(saves.sort(), ['Cloud Migration', 'Maria Lopez']); // both files written
});

test('connect is idempotent and refuses self-connect and goals', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  const again = await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  assert.equal(again, LT); // reports the existing link…
  assert.equal(store._state.members.get('Cloud Migration').entries.length, 1); // …adds nothing

  assert.equal(await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Maria Lopez'),
    null, 'self-connect refused');
  assert.equal(await store.connectToDiscussion('Maria Lopez', '2026-08-18 11:00:00', 'Cloud Migration'),
    null, 'goals are not linkable');
});

test('isReference discriminates by the tag prefix vs the own stem', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  const origin = store._state.members.get('Maria Lopez').entries[0];
  const ref = store._state.members.get('Cloud Migration').entries[0];
  assert.equal(store.isReference(origin, 'Maria Lopez'), false); // origin looks as-is
  assert.equal(store.isReference(ref, 'Cloud Migration'), true); // reference elsewhere
  assert.equal(store.isReference({ tags: ['task'] }, 'Anywhere'), false); // unlinked
});

/* ------------------------------- resolve ------------------------------ */

test('resolveOrigin returns the live origin entry for a reference', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  const ref = store._state.members.get('Cloud Migration').entries[0];
  const r = await store.resolveOrigin(ref);
  assert.equal(r.broken, undefined);
  assert.equal(r.name, 'Maria Lopez');
  assert.equal(r.idx, 0);
  assert.equal(r.entry.created_at, '2026-08-18 10:30:00'); // the origin, not the stub
  assert.ok(r.entry.body.includes('More detail here.'));   // full body, not cached title
});

test('resolveOrigin reports broken when the origin is gone or unlinked', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  const ref = store._state.members.get('Cloud Migration').entries[0];

  // Origin discussion deleted from nav (file gone) -> broken.
  store._state.nav.discussions = store._state.nav.discussions.filter(d => d.name !== 'Maria Lopez');
  assert.deepEqual(await store.resolveOrigin(ref), { broken: true });

  // Origin archived -> broken (treated as not loadable).
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  store._state.nav.discussions.find(d => d.name === 'Maria Lopez').archived = true;
  assert.deepEqual(await store.resolveOrigin(store._state.members.get('Cloud Migration').entries[0]),
    { broken: true });

  // Unlinked entry -> broken.
  assert.deepEqual(await store.resolveOrigin({ tags: ['task'] }), { broken: true });
});

/* ------------------------------ disconnect ----------------------------- */

test('disconnectFromDiscussion removes only the reference; origin untouched', async () => {
  seed();
  const lt = await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  assert.equal(await store.disconnectFromDiscussion('Cloud Migration', lt), true);
  assert.equal(store._state.members.get('Cloud Migration').entries.length, 0);
  const origin = store._state.members.get('Maria Lopez').entries[0];
  assert.ok(origin.tags.includes(lt), 'origin keeps its link tag');
  assert.equal(await store.disconnectFromDiscussion('Cloud Migration', lt), false); // already gone
});

test('disconnect never removes the origin entry itself', async () => {
  seed();
  const lt = await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  assert.equal(await store.disconnectFromDiscussion('Maria Lopez', lt), false);
  assert.equal(store._state.members.get('Maria Lopez').entries.length, 2);
});

/* ------------------------- aggregate stub-skipping ---------------------- */

test('collectEntries skips reference stubs — a linked task counts once', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  const all = store.collectEntries();
  const hits = all.filter(e => tags.linkTagOf(e.tags) === LT);
  assert.equal(hits.length, 1, 'exactly one card across all discussions');
  assert.equal(hits[0]._member, 'Maria Lopez', 'and it is the origin');
});

test('getRo3Candidates inherits the stub-skipping (no double chance in Ro3)', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  const cands = store.getRo3Candidates(null);
  assert.equal(cands.filter(e => tags.linkTagOf(e.tags) === LT).length, 1);
});

/* -------------------------- chains & rename ---------------------------- */

test('connecting FROM a reference links the origin — never a chain', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  // Third discussion joins.
  store._state.nav.discussions.push({ name: 'SOC 2 Compliance', tag: null, favorite: false, archived: false });
  const soc = { name: 'SOC 2 Compliance', prep: '', entries: [] };
  store._state.members.set('SOC 2 Compliance', soc);
  disk.set('SOC 2 Compliance', soc);
  // Connect from the REFERENCE card in Cloud Migration…
  const ref = store._state.members.get('Cloud Migration').entries[0];
  const lt = await store.connectToDiscussion('Cloud Migration', ref.created_at, 'SOC 2 Compliance');
  // …and the new link still names the origin, with the same id.
  assert.equal(lt, LT);
  assert.deepEqual(soc.entries[0].tags, ['task', LT]);
});

test('renameDiscussion rewrites link-tag stems on the origin and every reference', async () => {
  seed();
  await store.connectToDiscussion('Maria Lopez', '2026-08-18 10:30:00', 'Cloud Migration');
  await store.renameDiscussion('Maria Lopez', 'Maria Lopez-Garcia');

  const NEW = 'Maria Lopez-Garcia:link-00000';
  const origin = store._state.members.get('Maria Lopez-Garcia').entries[0];
  assert.ok(origin.tags.includes(NEW), 'origin tag rewritten');
  assert.ok(!origin.tags.includes(LT), 'old stem gone from origin');
  const ref = store._state.members.get('Cloud Migration').entries[0];
  assert.ok(ref.tags.includes(NEW), 'reference tag rewritten');

  // The link still resolves after the rename.
  const r = await store.resolveOrigin(ref);
  assert.equal(r.broken, undefined);
  assert.equal(r.name, 'Maria Lopez-Garcia');
});

/* ------------------------- on-disk round-trip --------------------------- */

test('a reference entry round-trips byte-identically through format', () => {
  const member = { name: 'Cloud Migration', prep: '', entries: [
    { created_at: '2026-08-18 14:05:00', tags: ['task', 'Maria Lopez:link-00000'], goal: null, due: null,
      body: 'Coordinate the vendor security review.' }
  ] };
  const md = format.serializeDiscussion(member);
  const back = format.parseDiscussion(md, 'Cloud Migration.md');
  assert.deepEqual(back.entries[0].tags, ['task', 'Maria Lopez:link-00000']);
  assert.equal(format.serializeDiscussion(back), md, 'byte-identical round-trip');
});
