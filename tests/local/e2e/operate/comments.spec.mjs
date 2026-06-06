// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — All Comments page (#allCommentsScreen): aggregation, unified search,
// and comment CRUD (move / delete / edit). Task-row state/priority/activity are
// covered in task-goal-changes.spec.mjs.

import { test, expect } from '../fixtures/operate.mjs';

test.describe('All Comments page', () => {
  test('aggregates entries from every discussion', async ({ app }) => {
    await app.screen('allComments');
    const screen = app.page.locator('#allCommentsScreen');
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' }).first()).toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'James Okafor' }).first()).toBeVisible();
  });

  test('unified search filters by #tag', async ({ app }) => {
    await app.screen('allComments');
    await app.search('#task');
    const screen = app.page.locator('#allCommentsScreen');
    await expect(screen).toContainText('Fix the deployment pipeline');
    await expect(screen).not.toContainText('Kickoff: aligned on Q2');
  });

  test('unified search filters by @name', async ({ app }) => {
    await app.screen('allComments');
    await app.search('@[Priya Nair]');
    await expect(app.page.locator('#allCommentsScreen')).toContainText('Follow up on the training budget');
  });

  test('unified search filters by freetext', async ({ app }) => {
    await app.screen('allComments');
    await app.search('rollback');
    const screen = app.page.locator('#allCommentsScreen');
    await expect(screen).toContainText('Define the rollback runbook');
    await expect(screen).not.toContainText('Kickoff');
  });

  test('move a comment to another discussion persists', async ({ app }) => {
    await app.screen('allComments');
    await app.moveComment(app.card('Kickoff: aligned on Q2'), '1-1 James Okafor');
    await expect.poll(() => app.readDiscussion('1-1 James Okafor')).toContain('Kickoff: aligned on Q2');
    expect(await app.readDiscussion('1-1 Maria Lopez')).not.toContain('Kickoff: aligned on Q2');
    expect(await app.readDiscussion('1-1 James Okafor')).toContain('Moved from');
  });

  test('delete a comment removes it from the .md', async ({ app }) => {
    await app.screen('allComments');
    await app.deleteComment(app.card('validate the staging cutover'));
    await expect.poll(() => app.readDiscussion('Cloud Migration')).not.toContain('validate the staging cutover');
  });

  test('edit a comment body persists', async ({ app }) => {
    // Edit lives in the discussion view (cross-view cards have no edit handler).
    // VERIFY: inline-edit textarea/save selectors on the first real run.
    await app.open('Cloud Migration');
    const entry = app.page.locator('.entry-card', { hasText: 'rollback runbook' }).first();
    await entry.locator('.entry-edit-btn').first().click();
    await app.page.locator('textarea').first().fill('Define the rollback runbook (revised).');
    await app.page.locator('#main .btn-primary', { hasText: 'Save' }).first().click();
    await expect.poll(() => app.readDiscussion('Cloud Migration')).toContain('revised');
  });
});
