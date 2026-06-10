// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — task & goal changes across the app's surfaces (change state /
// priority / activity / due). Each test drives the real UI control and asserts
// the change persisted to the discussion .md on disk (read back from OPFS).
//
// Seed entries used (from fixtures/dataset.mjs):
//   1-1 Maria Lopez : "Fix the deployment pipeline by end of sprint." (task, high, OPEN)
//                     "Senior promotion — finalize scope..." (goal, open)
//   Cloud Migration : "Define the rollback runbook." (task, high, CHK)

import { test, expect } from '../fixtures/operate.mjs';

const MARIA = '1-1 Maria Lopez';
const TASK = 'Fix the deployment pipeline';
const GOAL = 'Senior promotion';
const CLOUD = 'Cloud Migration';
const RUNBOOK = 'Define the rollback runbook';

test.describe('task & goal changes across surfaces', () => {

  test.describe('Discussion right column — task row', () => {
    test('change state: state square moves OPEN -> WIP (inprogresstask on disk)', async ({ app }) => {
      await app.open(MARIA);
      await app.chooseState(app.taskRow(TASK), 'WIP');
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('inprogresstask');
    });
    test('change priority: priority square cycles the priority tag (high -> medium)', async ({ app }) => {
      await app.open(MARIA);
      await app.clickPriority(app.taskRow(TASK));
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('medium');
    });
    test('add an activity: appends a dated action bullet', async ({ app }) => {
      await app.open(MARIA);
      await app.addAction(app.taskRow(TASK), 'Checked staging');
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('Task Resolution Actions');
      expect(await app.readDiscussion(MARIA)).toContain('Checked staging');
    });
    test('add a due date: writes due: <date> to the header', async ({ app }) => {
      await app.open(MARIA);
      await app.setDue(app.taskRow(TASK), '2026-07-01');
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('due: 2026-07-01');
    });
    test('mute: 🔇 toggles a muted: tag on the task', async ({ app }) => {
      await app.open(MARIA);
      await app.toggleMute(app.taskRow(TASK));
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('muted:');
    });
    test('mute: 🔇 toggles a muted: tag on a followup', async ({ app }) => {
      await app.open('1-1 James Okafor');
      await app.toggleMute(app.taskRow('Follow up on the training budget'));
      await expect.poll(() => app.readDiscussion('1-1 James Okafor')).toContain('muted:');
    });
  });

  test.describe('Discussion right column — goal row', () => {
    test('change state: ✓ marks achieved (achievedgoal + Achieved: marker)', async ({ app }) => {
      await app.open(MARIA);
      await app.achieveGoal(app.goalRow(GOAL));
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('achievedgoal');
      expect(await app.readDiscussion(MARIA)).toContain('Achieved:');
    });
    test('change state: ✕ marks canceled (canceledgoal + Canceled: marker)', async ({ app }) => {
      await app.open(MARIA);
      await app.cancelGoal(app.goalRow(GOAL));
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('canceledgoal');
      expect(await app.readDiscussion(MARIA)).toContain('Canceled:');
    });
    test('add an activity: appends a "Goal Actions" bullet', async ({ app }) => {
      await app.open(MARIA);
      await app.addAction(app.goalRow(GOAL), 'Met stakeholders');
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('Goal Actions');
      expect(await app.readDiscussion(MARIA)).toContain('Met stakeholders');
    });
  });

  test.describe('Kanban board', () => {
    test('change state: drag a card to CHK column (checktask on disk)', async ({ app }) => {
      await app.screen('kanban');
      await app.dragToColumn(TASK, 'CHK');
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('checktask');
    });
    test('change state: drag a card to DONE column (resolvedtask + → DONE action)', async ({ app }) => {
      await app.screen('kanban');
      await app.dragToColumn(TASK, 'DONE');
      await expect.poll(() => app.readDiscussion(MARIA)).toContain('resolvedtask');
      expect(await app.readDiscussion(MARIA)).toContain(': → DONE');
    });
  });

  test.describe('All Tasks page', () => {
    test('change state: state square sets HOLD (onholdtask on disk)', async ({ app }) => {
      await app.screen('allTasks');
      await app.chooseState(app.card(RUNBOOK), 'HOLD');
      await expect.poll(() => app.readDiscussion(CLOUD)).toContain('onholdtask');
    });
    test('change priority: priority square cycles the priority tag', async ({ app }) => {
      await app.screen('allTasks');
      await app.clickPriority(app.card(RUNBOOK));
      await expect.poll(() => app.readDiscussion(CLOUD)).toContain('medium');
    });
    test('add an activity: appends an action bullet', async ({ app }) => {
      await app.screen('allTasks');
      await app.addAction(app.card(RUNBOOK), 'Drafted runbook');
      await expect.poll(() => app.readDiscussion(CLOUD)).toContain('Drafted runbook');
    });

    // TEST-FIRST: documents the desired behavior. entryCard has no muted styling
    // and openTasks sorts by date only, so this is expected to FAIL until muting
    // dims the card (like done tasks) and sorts it to the bottom.
    test('mute: muting a task dims it and sends it to the bottom of the list', async ({ app }) => {
      await app.screen('allTasks');
      const cards = app.page.locator('#allTasksScreen .entry-card');
      await expect(cards.first()).toBeVisible();
      const top = cards.first();
      const id = await top.getAttribute('data-entry-id');

      await app.toggleMute(top);

      // dimmed like done tasks (reduced opacity)
      const muted = app.page.locator(`#allTasksScreen .entry-card[data-entry-id="${id}"]`);
      await expect.poll(() => muted.evaluate(el => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(1);
      // and moved to the bottom of the list
      await expect(cards.last()).toHaveAttribute('data-entry-id', id);
    });
  });

  test.describe('Ro3 (Rule of Three) page', () => {
    test('change state: state square sets WIP on a focus task (persists to disk)', async ({ app }) => {
      // Ro3 cards are snapshots and do not visually update, so assert the .md.
      await app.screen('ro3');
      const card = app.page.locator('.entry-card').first();
      const member = (await card.locator('.member-name-label').first().textContent()).trim();
      await app.chooseState(card, 'WIP');
      await expect.poll(() => app.readDiscussion(member)).toContain('inprogresstask');
    });
    test('change priority: priority square changes the focus task priority (persists)', async ({ app }) => {
      await app.screen('ro3');
      const card = app.page.locator('.entry-card').first();
      const member = (await card.locator('.member-name-label').first().textContent()).trim();
      const before = await app.readDiscussion(member);
      await app.clickPriority(card);
      await expect.poll(() => app.readDiscussion(member)).not.toBe(before);
    });

    // TEST-FIRST: documents the desired behavior. Ro3 currently caches its pick
    // and only re-rolls on the ↻ Refresh button, so this is expected to FAIL until
    // the app auto-backfills on mute. Precondition: the seed has >3 open,
    // non-muted tasks, so a replacement exists.
    test('mute: muting a focus task removes it and backfills a replacement', async ({ app }) => {
      await app.screen('ro3');
      const cards = app.page.locator('#ro3Screen .entry-card');
      await expect(cards).toHaveCount(3);
      const target = cards.first();
      const mutedId = await target.getAttribute('data-entry-id');

      await app.toggleMute(target);

      // The muted task disappears and Ro3 still shows three (a new one slid in).
      await expect(app.page.locator('#ro3Screen .entry-card')).toHaveCount(3);
      await expect(app.page.locator(`#ro3Screen .entry-card[data-entry-id="${mutedId}"]`)).toHaveCount(0);
    });
    test('add an activity: action modal submits without error', async ({ app }) => {
      await app.screen('ro3');
      const row = app.page.locator('.entry-card').first();
      await app.addAction(row, 'Ro3 note');
      await expect(app.page.locator('.modal-overlay')).toHaveCount(0);
    });
    test('add a due date: set due on the focus task via its discussion', async ({ app }) => {
      await app.screen('ro3');
      const member = (await app.page.locator('.entry-card .member-name-label').first().textContent()).trim();
      await app.open(member);
      await app.setDue(app.page.locator('.task-item').first(), '2026-08-15');
      await expect.poll(() => app.readDiscussion(member)).toContain('due: 2026-08-15');
    });
  });
});
