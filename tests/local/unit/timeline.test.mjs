// SPDX-License-Identifier: Apache-2.0
//
// monthlyTimeline — the Activity-over-time series, now including actions and
// state changes. Each dated bullet counts in the month of ITS OWN date, and
// "- date : → LABEL" bullets are state changes, everything else an action.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../../src/local/taxonomy.js');
require('../../../src/local/dashboard.js');
const { monthlyTimeline } = globalThis.Chippy.dashboard;

const mk = (created, tags, body) => ({ created_at: created, tags, goal: null, due: null, body });

test('actions and state changes count in the month of their own date', () => {
  const rows = monthlyTimeline([
    mk('2026-03-05 09:00:00', ['task'],
      'Fix pipeline.\n\nTask Resolution Actions\n- 2026-03-10 : Investigated logs.\n- 2026-06-02 : Deployed the fix.\n- 2026-06-03 : → DONE')
  ]);
  const mar = rows.find(r => r.month === '2026-03');
  const jun = rows.find(r => r.month === '2026-06');
  assert.deepEqual([mar.tasks, mar.actions, mar.stateChanges], [1, 1, 0]);
  assert.ok(jun, 'June row exists although no entry was created in June');
  assert.deepEqual([jun.tasks, jun.actions, jun.stateChanges], [0, 1, 1]);
});

test('plain comments and bullets in list-style bodies are not miscounted', () => {
  const rows = monthlyTimeline([
    mk('2026-04-01 09:00:00', [], 'Notes:\n- just a markdown bullet, not dated\n- another one')
  ]);
  assert.deepEqual([rows[0].comments, rows[0].actions, rows[0].stateChanges], [1, 0, 0]);
});
