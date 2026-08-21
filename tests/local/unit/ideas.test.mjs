// SPDX-License-Identifier: Apache-2.0
//
// Ideas feature — pure-helper unit tests (Phases 1–4).
// Covers taxonomy classification, the #idea:<state> search syntax, the
// Idea Actions body model, interest levels, dashboard aggregations, and a
// performance sanity check with a large idea count (R: Phase 4 acceptance).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from './_load.mjs';
import '../../../src/local/dashboard.js'; // registers Chippy.dashboard (pure aggregations)

const tags = globalThis.Chippy.tags;
const dashboard = globalThis.Chippy.dashboard;

const mk = (t, body = 'x', created = '2026-07-01 10:00:00') => ({ tags: t, body, created_at: created });

test('taxonomy: ideas are their own entry type and their tags are reserved', () => {
  assert.equal(tags.entryType(mk(['idea', 'technical'])), 'idea');
  assert.equal(tags.entryType(mk(['task'])), 'task');
  assert.equal(tags.entryType(mk(['career'])), 'comment');
  for (const t of ['idea', 'consideredidea', 'exploredidea', 'promoteditea', 'shelvedidea']) {
    assert.ok(tags.isReserved(t), t + ' should be reserved');
  }
  assert.ok(tags.PROMOTABLE.test('idea'), '#idea should be typeable');
  assert.ok(!tags.PROMOTABLE.test('exploredidea'), 'state tags stay app-managed');
});

test('search: #idea and #idea:<state> / #state:<state> filter by lifecycle state', () => {
  const es = [
    mk(['idea']),                     // considered (default)
    mk(['idea', 'exploredidea']),
    mk(['idea', 'promoteditea']),
    mk(['idea', 'shelvedidea']),
    mk(['task'])
  ];
  assert.equal(store.applyUnifiedFilter(es, '#idea').length, 4);
  assert.equal(store.applyUnifiedFilter(es, '#idea:considered').length, 1);
  assert.equal(store.applyUnifiedFilter(es, '#idea:explored').length, 1);
  assert.equal(store.applyUnifiedFilter(es, '#idea:promoted').length, 1);
  assert.equal(store.applyUnifiedFilter(es, '#idea:shelved').length, 1);
  assert.equal(store.applyUnifiedFilter(es, '#state:explored').length, 1);
  assert.equal(store.applyUnifiedFilter(es, '#idea:explored #idea').length, 1); // combinable
});

test('body model: Idea Actions header round-trips without duplication', () => {
  const e = mk(['idea', 'exploredidea'],
    'Mentor juniors on architecture.\n\nIdea Actions\n- 2026-03-01 : Initial capture.\n- 2026-03-05 : → Explored');
  assert.equal(store.actionLabelFor(e), 'Idea Actions');
  const parts = store.splitBodyParts(e.body);
  assert.equal(parts.comment, 'Mentor juniors on architecture.');
  assert.equal(parts.bullets.length, 2);
  const rejoined = store.joinBodyParts(parts, e);
  assert.equal((rejoined.match(/Idea Actions/g) || []).length, 1, 'exactly one header after round-trip');
  assert.equal(rejoined, e.body);
});

test('interest level: counts action bullets plus links', () => {
  assert.equal(store.ideaInterestOf(mk(['idea'], 'plain thought')), 0);
  assert.equal(store.ideaInterestOf(mk(['idea'],
    'See [doc](https://x.y) and [ref](https://a.b)\n\nIdea Actions\n- 2026-03-01 : Discussed.')), 3);
});

test('dashboard: idea state distribution and inflow/timeline series', () => {
  const es = [
    mk(['idea']), mk(['idea', 'exploredidea']), mk(['idea', 'shelvedidea']),
    mk(['task']), mk([], 'c')
  ];
  assert.deepEqual(dashboard.ideaStateCounts(es), { considered: 1, explored: 1, promoted: 0, shelved: 1 });
  const inflow = dashboard.inflowByRange(es, 'all');
  assert.equal(inflow.idea, 3);
  assert.equal(inflow.comment, 1);
  const tl = dashboard.monthlyTimeline(es);
  assert.equal(tl.length, 1);
  assert.equal(tl[0].ideas, 3);
  assert.equal(tl[0].comments, 1);
});

test('performance: filtering and aggregating 5000 ideas stays fast', () => {
  const states = [[], ['exploredidea'], ['promoteditea'], ['shelvedidea']];
  const es = [];
  for (let i = 0; i < 5000; i++) {
    const mo = String(1 + (i % 12)).padStart(2, '0');
    es.push(mk(['idea', 'technical', ...states[i % 4]],
      'Idea number ' + i + ' with a [link](https://example.com/' + i + ')\n\nIdea Actions\n- 2026-01-01 : Captured.',
      '2026-' + mo + '-01 10:00:00'));
  }
  const t0 = performance.now();
  const explored = store.applyUnifiedFilter(es, '#idea:explored');
  const counts = dashboard.ideaStateCounts(es);
  const tl = dashboard.monthlyTimeline(es);
  for (const e of es) store.ideaInterestOf(e);
  const ms = performance.now() - t0;
  assert.equal(explored.length, 1250);
  assert.equal(counts.considered + counts.explored + counts.promoted + counts.shelved, 5000);
  assert.equal(tl.reduce((s, r) => s + r.ideas, 0), 5000);
  assert.ok(ms < 1000, `aggregations over 5000 ideas took ${ms.toFixed(0)}ms (budget 1000ms)`);
});
