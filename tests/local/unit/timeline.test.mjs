// SPDX-License-Identifier: Apache-2.0
//
// weeklyTimeline — the Activity-over-time series on a weekly x-axis, including
// actions and state changes. Each dated bullet counts in the week of ITS OWN
// date, "- date : → LABEL" bullets are state changes, and the span is
// gap-filled so the line chart's x-axis is even.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../../src/local/taxonomy.js');
require('../../../src/local/dashboard.js');
const { weeklyTimeline, weekOf } = globalThis.Chippy.dashboard;

const mk = (created, tags, body) => ({ created_at: created, tags, goal: null, due: null, body });

test('actions and state changes count in the week of their own date', () => {
  const rows = weeklyTimeline([
    mk('2026-03-05 09:00:00', ['task'],
      'Fix pipeline.\n\nTask Resolution Actions\n- 2026-03-10 : Investigated logs.\n- 2026-06-02 : Deployed the fix.\n- 2026-06-03 : → DONE')
  ]);
  const creation = rows.find(r => r.week === weekOf('2026-03-05')); // 2026-03-02
  const actionWk = rows.find(r => r.week === weekOf('2026-03-10')); // 2026-03-09
  const juneWk   = rows.find(r => r.week === weekOf('2026-06-02')); // 2026-06-01
  assert.deepEqual([creation.tasks, creation.actions], [1, 0]);
  assert.deepEqual([actionWk.tasks, actionWk.actions], [0, 1]);
  assert.deepEqual([juneWk.actions, juneWk.stateChanges], [1, 1]);
});

test('weeks between activity are gap-filled with empty rows', () => {
  const rows = weeklyTimeline([
    mk('2026-03-02 09:00:00', [], 'first'),
    mk('2026-03-23 09:00:00', [], 'three weeks later')
  ]);
  assert.deepEqual(rows.map(r => r.week), ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']);
  assert.deepEqual(rows.map(r => r.comments), [1, 0, 0, 1]);
});

test('plain markdown bullets in bodies are not miscounted', () => {
  const rows = weeklyTimeline([
    mk('2026-04-01 09:00:00', [], 'Notes:\n- just a markdown bullet, not dated\n- another one')
  ]);
  assert.deepEqual([rows[0].comments, rows[0].actions, rows[0].stateChanges], [1, 0, 0]);
});
