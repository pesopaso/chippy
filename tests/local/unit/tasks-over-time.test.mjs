// SPDX-License-Identifier: Apache-2.0
//
// taskStatesOverTime / taskTransitions — the "Tasks over time (by state)"
// aggregation on a WEEKLY x-axis: samples the population at the end of every
// ISO week (rows keyed by the week's Monday); open/WIP/CHK/HOLD/PRGT counted,
// DONE and OBSL excluded. Rebuilt from dated state-change action bullets and
// legacy Resolved:/Obsolete: markers; robust to incomplete history.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../../src/local/taxonomy.js');
require('../../../src/local/dashboard.js');
const { taskStatesOverTime, taskTransitions, weekOf } = globalThis.Chippy.dashboard;

const TODAY = '2026-09-17';
const task = (created, tags, body) => ({ created_at: created, tags, goal: null, due: null, body });
const at = (rows, day) => rows.find(r => r.week === weekOf(day));

test('recorded actions drive the weekly timeline; task starts OPEN at creation', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'checktask'],
      'Do the thing.\n\nActions:\n- 2026-03-10 : → WIP\n- 2026-05-02 : → CHK')
  ], TODAY);
  assert.equal(rows[0].week, weekOf('2026-01-15'));
  assert.equal(at(rows, '2026-01-15').open, 1);
  assert.equal(at(rows, '2026-03-02').open, 1);          // week before the WIP action
  assert.equal(at(rows, '2026-03-10').inprogress, 1);    // WIP from its own week on
  assert.equal(at(rows, '2026-05-02').check, 1);         // CHK from its own week on
  assert.equal(rows[rows.length - 1].check, 1);
});

test('a → DONE action removes the task from the chart from that week on', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'resolvedtask'],
      'Ship it.\n\nActions:\n- 2026-02-20 : → DONE')
  ], TODAY);
  assert.equal(at(rows, '2026-02-09').open, 1);          // week before the close
  const closed = at(rows, '2026-02-20');
  for (const k of ['open', 'inprogress', 'check', 'onhold', 'purgatory']) assert.equal(closed[k], 0);
});

test('legacy "Resolved: YYYY-MM" marker closes the task at that month start', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'resolvedtask'], 'Old one.\n\nResolved: 2026-02')
  ], TODAY);
  assert.equal(at(rows, '2026-01-19').open, 1);
  assert.equal(at(rows, '2026-02-01').open, 0);          // marker reads as 2026-02-01
});

test('no recorded history: the current state is assumed since creation', () => {
  const rows = taskStatesOverTime([
    task('2026-02-10 09:00', ['task', 'onholdtask'], 'Waiting.')
  ], TODAY);
  assert.equal(at(rows, '2026-02-10').onhold, 1);
  assert.equal(rows[rows.length - 1].onhold, 1);
});

test('no recorded history + closed: never fabricates an open period', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'resolvedtask'], 'Done long ago, no records.')
  ], TODAY);
  for (const r of rows) for (const k of ['open', 'inprogress', 'check', 'onhold', 'purgatory'])
    assert.equal(r[k], 0, r.week + ' ' + k);
});

test('history disagreeing with tags snaps to the current state today', () => {
  const t = task('2026-01-15 09:00', ['task', 'checktask'],
    'Mismatch.\n\nActions:\n- 2026-02-01 : → WIP');
  const { tr } = taskTransitions(t, TODAY);
  assert.deepEqual(tr[tr.length - 1], { date: TODAY, key: 'check' });
  const rows = taskStatesOverTime([t], TODAY);
  assert.equal(at(rows, '2026-03-02').inprogress, 1);    // history honoured
  const last = rows[rows.length - 1];
  assert.equal(last.inprogress, 0);
  assert.equal(last.check, 1);                           // final week matches the state pie
});

test('followups are included; weeks span creation to today', () => {
  const rows = taskStatesOverTime([
    task('2026-07-06 09:00', ['followup'], 'Ping again.')
  ], TODAY);
  assert.equal(rows[0].week, weekOf('2026-07-06'));
  assert.equal(rows[rows.length - 1].week, weekOf(TODAY));
  assert.ok(rows.every(r => r.open === 1));
});
