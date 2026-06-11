// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — unified search & cross-discussion views (the in-browser counterpart
// to the applyUnifiedFilter / parseSearchQuery unit tests).

import { test, expect } from '../fixtures/operate.mjs';

test.describe('unified search & cross-discussion views', () => {
  test('unified query filters by #tag', async ({ app }) => {
    await app.screen('allComments');
    await app.search('#task');
    const screen = app.page.locator('#allCommentsScreen');
    await expect(screen).toContainText('Fix the deployment pipeline');
    await expect(screen).not.toContainText('Kickoff: aligned on Q2');
  });

  test('Tasks cross-view aggregates across discussions', async ({ app }) => {
    await app.screen('allTasks');
    const screen = app.page.locator('#allTasksScreen');
    await expect(screen).toContainText('Fix the deployment pipeline'); // 1-1 Maria Lopez
    await expect(screen).toContainText('Define the rollback runbook'); // Cloud Migration
  });

  test('Rule-of-Three surfaces up to three focus tasks', async ({ app }) => {
    await app.screen('ro3');
    const n = await app.page.locator('#ro3Screen .entry-card').count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
  });

  test('Kanban has the unified search and filters the board', async ({ app }) => {
    await app.screen('kanban');
    const screen = app.page.locator('#kanbanScreen');
    await expect(screen).toContainText('Fix the deployment pipeline');
    await expect(screen).toContainText('Define the rollback runbook');
    await app.search('pipeline');
    await expect(screen).toContainText('Fix the deployment pipeline');
    await expect(screen).not.toContainText('Define the rollback runbook');
    // clearing restores the full board
    await app.search('');
    await expect(screen).toContainText('Define the rollback runbook');
  });
});
