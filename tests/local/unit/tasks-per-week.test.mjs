// SPDX-License-Identifier: Apache-2.0
//
// taskExecution — "Tasks created per week (by current state)": tasks bucket
// into the ISO week of their creation, keyed by that week's Monday; weeks
// with no tasks inside the span are filled as empty rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../../src/local/taxonomy.js');
require('../../../src/local/dashboard.js');
const { taskExecution, weekOf } = globalThis.Chippy.dashboard;

const task = (created, tags) => ({ created_at: created, tags, goal: null, due: null, body: 'x' });

test('days of the same ISO week aggregate into one Monday-keyed row', () => {
  // 2026-09-14 is a Monday; 16th and 18th are the same week.
  const rows = taskExecution([
    task('2026-09-14 09:00:00', ['task']),
    task('2026-09-16 09:00:00', ['task', 'inprogresstask']),
    task('2026-09-18 09:00:00', ['followup', 'resolvedtask'])
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].week, '2026-09-14');
  assert.deepEqual([rows[0].total, rows[0].open, rows[0].inprogress, rows[0].resolved], [3, 1, 1, 1]);
});

test('weeks without tasks inside the span are filled as empty rows', () => {
  const rows = taskExecution([
    task('2026-08-31 09:00:00', ['task']),   // Mon, week 2026-08-31
    task('2026-09-15 09:00:00', ['task'])    // Tue, week 2026-09-14
  ]);
  assert.deepEqual(rows.map(r => r.week), ['2026-08-31', '2026-09-07', '2026-09-14']);
  assert.deepEqual(rows.map(r => r.total), [1, 0, 1]);
});

test('Sunday belongs to the week started by the preceding Monday', () => {
  assert.equal(weekOf('2026-09-20'), '2026-09-14'); // Sun -> that week's Monday
  assert.equal(weekOf('2026-09-14'), '2026-09-14'); // Monday maps to itself
});
