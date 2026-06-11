// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — the shared @name autocomplete (ui.attachNameAutocomplete) on every
// surface it is attached to: the new-comment composer, the inline comment
// editor, the cross-view search box, and the ⚡ action modal (dev.96–dev.99).
//
// Picks are driven with a mousedown dispatch — the helper picks on mousedown
// (with preventDefault) so the field never blurs; a full click would race the
// dropdown removal.
//
// Names come from the seeded discussions: "1-1 Maria Lopez" mentions
// @[Maria Lopez] and @[Tom Reyes], so they are registered (names index +
// dev.97 self-heal) once that discussion is open.

import { test, expect } from '../fixtures/operate.mjs';

const MARIA = '1-1 Maria Lopez';
const TASK = 'Fix the deployment pipeline';

test.describe('@name autocomplete', () => {

  test('new comment: @token opens the dropdown; picking inserts @[Full Name]', async ({ app }) => {
    await app.open(MARIA);
    const ta = app.page.locator('#entryInput');
    await ta.click();
    await ta.pressSequentially('Sync with @Tom');
    const opt = app.page.locator('.ac-float .ac-option', { hasText: 'Tom Reyes' }).first();
    await expect(opt).toBeVisible();
    await opt.dispatchEvent('mousedown');
    await expect(ta).toHaveValue('Sync with @[Tom Reyes] ');
    // dropdown is gone after the pick
    await expect(app.page.locator('.ac-float')).toHaveCount(0);
  });

  test('new comment: an unknown token offers + New name and inserts it', async ({ app }) => {
    await app.open(MARIA);
    const ta = app.page.locator('#entryInput');
    await ta.click();
    await ta.pressSequentially('Intro call with @Zara Quinn');
    const create = app.page.locator('.ac-float .ac-create');
    await expect(create).toBeVisible();
    await expect(create).toContainText('Zara Quinn');
    await create.dispatchEvent('mousedown');
    await expect(ta).toHaveValue('Intro call with @[Zara Quinn] ');
  });

  test('keyboard: ↑/↓ move the highlight, Enter confirms the name instead of saving', async ({ app }) => {
    await app.open(MARIA);
    const ta = app.page.locator('#entryInput');
    await ta.click();
    await ta.pressSequentially('Check with @tom');
    await expect(app.page.locator('.ac-float .ac-option').first()).toBeVisible();
    await ta.press('ArrowDown'); // -> the "+ New name" row
    await ta.press('ArrowUp');   // back to Tom Reyes (top match)
    await ta.press('Enter');     // confirms the highlighted name — must NOT save
    await expect(ta).toHaveValue('Check with @[Tom Reyes] ');
    await expect(app.page.locator('.ac-float')).toHaveCount(0);
    expect(await app.readDiscussion(MARIA)).not.toContain('Check with');
    // with the dropdown closed, Enter passes through and saves the comment
    await ta.press('Enter');
    await expect.poll(() => app.readDiscussion(MARIA)).toContain('Check with @[Tom Reyes]');
  });

  test('edit comment: dropdown works in the inline editor and the pick persists on save', async ({ app }) => {
    await app.open(MARIA);
    const card = app.page.locator('#memberScreen .entry-card', { hasText: TASK }).first();
    await card.locator('.entry-edit-btn').click();
    const ta = app.page.locator('.entry-edit-area');
    await expect(ta).toBeVisible();
    await ta.fill('Pipeline fix reviewed with ');
    await ta.pressSequentially('@Mar');
    const opt = app.page.locator('.ac-float .ac-option', { hasText: 'Maria Lopez' }).first();
    await expect(opt).toBeVisible();
    await opt.dispatchEvent('mousedown');
    await expect(ta).toHaveValue('Pipeline fix reviewed with @[Maria Lopez] ');
    await ta.press('Enter'); // saves the edit
    await expect.poll(() => app.readDiscussion(MARIA))
      .toContain('Pipeline fix reviewed with @[Maria Lopez]');
  });

  test('search box: picking a name inserts the filter form and narrows the list', async ({ app }) => {
    await app.open(MARIA); // registers the names before the cross view opens
    await app.screen('allComments');
    const inp = app.page.locator('#main .screen.active input.list-search').first();
    await inp.click();
    await inp.pressSequentially('@Tom');
    const opt = app.page.locator('.ac-float .ac-option', { hasText: 'Tom Reyes' }).first();
    await expect(opt).toBeVisible();
    await opt.dispatchEvent('mousedown');
    await expect(inp).toHaveValue('@[Tom Reyes] ');
    // the unified filter applied: every remaining card mentions the name
    const cards = app.page.locator('#main .screen.active .entry-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toContainText('Tom Reyes');
    // search boxes never offer creating a new name
    await inp.fill('');
    await inp.pressSequentially('@Nobody Known');
    await expect(app.page.locator('.ac-float .ac-create')).toHaveCount(0);
  });

  test('action modal: dropdown works in the ⚡ input and the action line persists', async ({ app }) => {
    await app.open(MARIA);
    const row = app.taskRow(TASK);
    await row.locator('.icon-btn', { hasText: '⚡' }).first().click();
    const inp = app.page.locator('.modal-input');
    await expect(inp).toBeVisible();
    await inp.click();
    await inp.pressSequentially('Aligned approach with @Tom');
    const opt = app.page.locator('.ac-float .ac-option', { hasText: 'Tom Reyes' }).first();
    await expect(opt).toBeVisible(); // floats above the modal overlay
    await opt.dispatchEvent('mousedown');
    await expect(inp).toHaveValue('Aligned approach with @[Tom Reyes] ');
    await app.page.locator('.modal-actions .btn-primary', { hasText: 'Add' }).click();
    await expect.poll(() => app.readDiscussion(MARIA))
      .toMatch(/- \d{4}-\d{2}-\d{2} : Aligned approach with @\[Tom Reyes\]/);
  });
});
