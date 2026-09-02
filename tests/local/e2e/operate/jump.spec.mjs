// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — jump-to-comment: every "go to this entry" gesture must scroll to
// the exact card in the discussion history and flash it. Guards the dev.10
// regression: scrollToEntry queried a class no card carries, so the jump was a
// silent no-op (the discussion opened, nothing scrolled or flashed).
//
// Seed entries used (from fixtures/dataset.mjs):
//   1-1 Maria Lopez : "Fix the deployment pipeline by end of sprint." (task)
//                     "Senior promotion — finalize scope..." (goal)

import { test, expect } from '../fixtures/operate.mjs';

const MARIA = '1-1 Maria Lopez';
const TASK = 'Fix the deployment pipeline';
const GOAL = 'Senior promotion';

// The history card for an entry: the .entry-card inside the history list.
function historyCard(app, text) {
  return app.page.locator('.history-list .entry-card', { hasText: text }).first();
}

test.describe('jump to comment', () => {
  test('right column: double-click a task row scrolls to and flashes its card', async ({ app }) => {
    await app.open(MARIA);
    const card = historyCard(app, TASK);
    await expect(card).toHaveAttribute('data-entry-id', /\d{4}-\d{2}-\d{2}/);
    await app.taskRow(TASK).locator('.task-text').dblclick();
    await expect(card).toHaveClass(/\bflash\b/);
    await expect(card).toBeInViewport();
  });

  test('right column: goal ✎ scrolls to the goal entry and opens its inline editor', async ({ app }) => {
    await app.open(MARIA);
    await app.goalRow(GOAL).locator('.icon-btn', { hasText: '✎' }).first().click();
    const card = historyCard(app, GOAL);
    await expect(card).toHaveClass(/\bflash\b/);
    await expect(card.locator('.entry-edit-area')).toBeVisible();
    await expect(card.locator('.entry-edit-area')).toHaveValue(/Senior promotion/);
  });

  test('cross page: double-click on All Tasks opens the discussion at the exact card', async ({ app }) => {
    await app.screen('allTasks');
    await app.page.locator('#allTasksScreen .entry-card', { hasText: TASK }).first()
      .locator('.entry-text').dblclick();
    await expect(app.page.locator('#memberScreen')).toHaveClass(/\bactive\b/);
    await expect(app.page.locator('#memberScreen .member-title')).toHaveText(MARIA);
    const card = historyCard(app, TASK);
    await expect(card).toHaveClass(/\bflash\b/);
    await expect(card).toBeInViewport();
  });
});
