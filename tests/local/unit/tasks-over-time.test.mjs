// SPDX-License-Identifier: Apache-2.0
//
// taskStatesOverTime / taskTransitions — the "Tasks over time (by state)"
// aggregation: monthly samples of every task's state (open/WIP/CHK/HOLD/PRGT;
// DONE and OBSL excluded), rebuilt from dated state-change action bullets and
// legacy Resolved:/Obsolete: markers. State actions were introduced later than
// the data, so the reconstruction must stay robust to incomplete history.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../../src/local/taxonomy.js');
require('../../../src/local/dashboard.js');
const { taskStatesOverTime, taskTransitions } = globalThis.Chippy.dashboard;

const TODAY = '2026-09-11';
const task = (created, tags, body) => ({ created_at: created, tags, goal: null, due: null, body });

test('recorded actions drive the timeline; task starts OPEN at creation', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'checktask'],
      'Do the thing.\n\nActions:\n- 2026-03-10 : → WIP\n- 2026-05-02 : → CHK')
  ], TODAY).filter(r => ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-09'].includes(r.month));
  assert.deepEqual(rows.map(r => [r.month, r.open, r.inprogress, r.check]), [
    ['2026-01', 1, 0, 0], ['2026-02', 1, 0, 0],
    ['2026-03', 0, 1, 0], ['2026-04', 0, 1, 0],
    ['2026-05', 0, 0, 1], ['2026-09', 0, 0, 1]
  ]);
});

test('a → DONE action removes the task from the chart from that month on', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'resolvedtask'],
      'Ship it.\n\nActions:\n- 2026-02-20 : → DONE')
  ], TODAY);
  const jan = rows.find(r => r.month === '2026-01');
  const feb = rows.find(r => r.month === '2026-02');
  assert.equal(jan.open, 1);
  for (const k of ['open', 'inprogress', 'check', 'onhold', 'purgatory']) assert.equal(feb[k], 0);
});

test('legacy "Resolved: YYYY-MM" marker closes the task at that month', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'resolvedtask'], 'Old one.\n\nResolved: 2026-02')
  ], TODAY);
  assert.equal(rows.find(r => r.month === '2026-01').open, 1);
  assert.equal(rows.find(r => r.month === '2026-02').open, 0);
});

test('no recorded history: the current state is assumed since creation', () => {
  // HOLD without any action bullets (state set before action logging existed)
  const rows = taskStatesOverTime([
    task('2026-02-10 09:00', ['task', 'onholdtask'], 'Waiting.')
  ], TODAY);
  assert.equal(rows.find(r => r.month === '2026-02').onhold, 1);
  assert.equal(rows.find(r => r.month === '2026-09').onhold, 1);
});

test('no recorded history + closed: never fabricates an open period', () => {
  const rows = taskStatesOverTime([
    task('2026-01-15 09:00', ['task', 'resolvedtask'], 'Done long ago, no records.')
  ], TODAY);
  for (const r of rows) for (const k of ['open', 'inprogress', 'check', 'onhold', 'purgatory'])
    assert.equal(r[k], 0, r.month + ' ' + k);
});

test('history disagreeing with tags snaps to the current state today', () => {
  // Actions say WIP, tags say CHK (edited by hand / pre-logging change).
  const t = task('2026-01-15 09:00', ['task', 'checktask'],
    'Mismatch.\n\nActions:\n- 2026-02-01 : → WIP');
  const { tr } = taskTransitions(t, TODAY);
  assert.deepEqual(tr[tr.length - 1], { date: TODAY, key: 'check' });
  const rows = taskStatesOverTime([t], TODAY);
  assert.equal(rows.find(r => r.month === '2026-03').inprogress, 1); // history honoured
  const last = rows[rows.length - 1];
  assert.equal(last.inprogress, 0);
  assert.equal(last.check, 1); // final month matches the state pie
});

test('followups are included; months span creation to today', () => {
  const rows = taskStatesOverTime([
    task('2026-07-05 09:00', ['followup'], 'Ping again.')
  ], TODAY);
  assert.equal(rows[0].month, '2026-07');
  assert.equal(rows[rows.length - 1].month, '2026-09');
  assert.ok(rows.every(r => r.open === 1));
});
