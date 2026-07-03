// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — Discussion tag filter (R61–R63)
//
// Tests cover:
//  1. Discussion view — inline tag editor (chip + clear, input + set)
//  2. Per-page discussion tag filter buttons on all cross-discussion pages
//
// Seed has two tag groups:
//   People  →  "1-1 James Okafor", "1-1 Maria Lopez"
//   DEV     →  "Cloud Migration",  "SOC 2 Compliance"
//
// Filter selectors (match the R61/R63 implementation plan):
//   Tag chip in discussion header    .disc-tag-chip
//   Remove-tag button inside chip    .disc-tag-chip .disc-tag-chip-x
//   Tag input (no tag set)           input.disc-tag-input
//   Filter button row                .disc-tag-filters
//   Individual filter button         .cross-disc-tag-filters .disc-tag-filter-btn
//   "All" filter button text         "All"
//
// All tests are TEST-FIRST — they will FAIL until R61–R63 are implemented.

import { test, expect } from '../fixtures/operate.mjs';

// ---------------------------------------------------------------------------
// 1. Discussion view — inline tag editor
// ---------------------------------------------------------------------------

test.describe('Discussion view — inline tag editor', () => {
  test('shows a colored chip when the discussion has a tag', async ({ app }) => {
    await app.open('Cloud Migration');
    const chip = app.page.locator('#memberScreen .disc-tag-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('DEV');
  });

  test('removing the tag chip clears the tag in navigation.chippy.md', async ({ app }) => {
    await app.open('Cloud Migration');
    await app.page.locator('#memberScreen .disc-tag-chip .disc-tag-chip-x').click();
    // chip disappears, input appears
    await expect(app.page.locator('#memberScreen .disc-tag-chip')).not.toBeVisible();
    await expect(app.page.locator('#memberScreen input.disc-tag-input')).toBeVisible();
    // persisted: navigation.chippy.md should no longer carry tag: DEV for Cloud Migration
    await expect.poll(async () => {
      const nav = await app.readFile('navigation.chippy.md');
      return nav;
    }, { timeout: 5000 }).not.toMatch(/Cloud Migration.*tag:\s*DEV/);
  });

  test('typing a tag in the input and pressing Enter sets the tag', async ({ app }) => {
    await app.open('SOC 2 Compliance');
    // remove existing tag first so the input is shown
    await app.page.locator('#memberScreen .disc-tag-chip .disc-tag-chip-x').click();
    const input = app.page.locator('#memberScreen input.disc-tag-input');
    await input.fill('QA');
    await input.press('Enter');
    // chip shows new tag
    await expect(app.page.locator('#memberScreen .disc-tag-chip')).toContainText('QA');
    // persisted
    await expect.poll(async () => app.readFile('navigation.chippy.md'), { timeout: 5000 })
      .toMatch(/SOC 2 Compliance.*tag:\s*QA/);
  });
});

// ---------------------------------------------------------------------------
// Helper — click a tag filter button by label on the active screen
// ---------------------------------------------------------------------------
async function clickTagFilter(page, label) {
  const screen = page.locator('#main .screen.active');
  const btn = screen.locator('.cross-disc-tag-filters .disc-tag-filter-btn', { hasText: new RegExp(`^${label}$`) });
  await btn.click();
}

// ---------------------------------------------------------------------------
// 2. All Comments — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('All Comments — discussion tag filter', () => {
  test('DEV filter shows only DEV-discussion entries', async ({ app }) => {
    await app.screen('allComments');
    await clickTagFilter(app.page, 'DEV');
    const screen = app.page.locator('#allCommentsScreen');
    // DEV discussions have entries referencing "Cloud Migration" / "SOC 2 Compliance"
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' }).first()).toBeVisible();
    // People discussions must not appear
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' })).not.toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'James Okafor' })).not.toBeVisible();
  });

  test('People filter shows only People-discussion entries', async ({ app }) => {
    await app.screen('allComments');
    await clickTagFilter(app.page, 'People');
    const screen = app.page.locator('#allCommentsScreen');
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' }).first()).toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' })).not.toBeVisible();
  });

  test('All button resets the filter', async ({ app }) => {
    await app.screen('allComments');
    await clickTagFilter(app.page, 'DEV');
    await clickTagFilter(app.page, 'All');
    const screen = app.page.locator('#allCommentsScreen');
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' }).first()).toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. All Tasks — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('All Tasks — discussion tag filter', () => {
  test('DEV filter shows only tasks from DEV discussions', async ({ app }) => {
    await app.screen('allTasks');
    await clickTagFilter(app.page, 'DEV');
    const screen = app.page.locator('#allTasksScreen');
    // Cloud Migration has a high-priority task: "Fix the deployment pipeline"
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' }).first()).toBeVisible();
    // People tasks must not appear
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' })).not.toBeVisible();
  });

  test('People filter shows only tasks from People discussions', async ({ app }) => {
    await app.screen('allTasks');
    await clickTagFilter(app.page, 'People');
    const screen = app.page.locator('#allTasksScreen');
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' }).first()).toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Kanban — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('Kanban — discussion tag filter', () => {
  test('DEV filter shows only DEV-discussion cards', async ({ app }) => {
    await app.screen('kanban');
    await clickTagFilter(app.page, 'DEV');
    const board = app.page.locator('#kanbanScreen');
    await expect(board.locator('.kanban-card', { hasText: 'Cloud Migration' }).first()).toBeVisible();
    await expect(board.locator('.kanban-card', { hasText: 'Maria Lopez' })).not.toBeVisible();
  });

  test('All button resets Kanban filter', async ({ app }) => {
    await app.screen('kanban');
    await clickTagFilter(app.page, 'DEV');
    await clickTagFilter(app.page, 'All');
    const board = app.page.locator('#kanbanScreen');
    await expect(board.locator('.kanban-card', { hasText: 'Maria Lopez' }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. All Goals — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('All Goals — discussion tag filter', () => {
  test('DEV filter shows only goals from DEV discussions', async ({ app }) => {
    await app.screen('allGoals');
    await clickTagFilter(app.page, 'DEV');
    const screen = app.page.locator('#allGoalsScreen');
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' }).first()).toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. All Images — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('All Images — discussion tag filter', () => {
  test('filter buttons are rendered on the All Images screen', async ({ app }) => {
    await app.screen('allImages');
    const filters = app.page.locator('#allImagesScreen .cross-disc-tag-filters');
    await expect(filters).toBeVisible();
    await expect(filters.locator('.disc-tag-filter-btn', { hasText: 'DEV' })).toBeVisible();
    await expect(filters.locator('.disc-tag-filter-btn', { hasText: 'People' })).toBeVisible();
  });

  test('DEV filter restricts image grid to DEV-discussion images', async ({ app }) => {
    await app.screen('allImages');
    await clickTagFilter(app.page, 'DEV');
    const screen = app.page.locator('#allImagesScreen');
    // After filtering, any image caption / member label should be from DEV only
    const memberLabels = screen.locator('.member-name-label');
    const count = await memberLabels.count();
    for (let i = 0; i < count; i++) {
      const text = await memberLabels.nth(i).innerText();
      expect(['Cloud Migration', 'SOC 2 Compliance']).toContain(text);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. All Links — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('All Links — discussion tag filter', () => {
  test('DEV filter shows only links from DEV discussions', async ({ app }) => {
    await app.screen('allLinks');
    await clickTagFilter(app.page, 'DEV');
    const screen = app.page.locator('#allLinksScreen');
    // Cloud Migration has a link in its kickoff entry
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' }).first()).toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8. All Names — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('All Names — discussion tag filter', () => {
  test('DEV filter restricts name counts to DEV-discussion entries', async ({ app }) => {
    await app.screen('allNames');
    // Priya Nair is mentioned in Cloud Migration (DEV); not in People discussions
    const allScreen = app.page.locator('#allNamesScreen');
    const priyaRowAll = allScreen.locator('.name-row', { hasText: 'Priya Nair' });
    const countBefore = parseInt(await priyaRowAll.locator('.name-count').innerText(), 10);

    await clickTagFilter(app.page, 'People');
    // Priya Nair should disappear (only in DEV discussions)
    await expect(allScreen.locator('.name-row', { hasText: 'Priya Nair' })).not.toBeVisible();

    await clickTagFilter(app.page, 'DEV');
    // Priya Nair reappears with the same count as before
    await expect(allScreen.locator('.name-row', { hasText: 'Priya Nair' })).toBeVisible();
    const countDev = parseInt(await allScreen.locator('.name-row', { hasText: 'Priya Nair' }).locator('.name-count').innerText(), 10);
    expect(countDev).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// 9. Ro3 — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('Ro3 — discussion tag filter', () => {
  test('filter buttons are rendered on the Ro3 screen', async ({ app }) => {
    await app.screen('ro3');
    const filters = app.page.locator('#ro3Screen .cross-disc-tag-filters');
    await expect(filters).toBeVisible();
    await expect(filters.locator('.disc-tag-filter-btn', { hasText: 'DEV' })).toBeVisible();
    await expect(filters.locator('.disc-tag-filter-btn', { hasText: 'People' })).toBeVisible();
  });

  test('DEV filter shows only cards from DEV discussions', async ({ app }) => {
    await app.screen('ro3');
    await clickTagFilter(app.page, 'DEV');
    const screen = app.page.locator('#ro3Screen');
    // DEV pool: Cloud Migration (CHK task + followup) + SOC 2 (PRGT task) = 3 candidates
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' }).first()).toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'Maria Lopez' })).not.toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'James Okafor' })).not.toBeVisible();
  });

  test('People filter shows only cards from People discussions', async ({ app }) => {
    await app.screen('ro3');
    await clickTagFilter(app.page, 'People');
    const screen = app.page.locator('#ro3Screen');
    await expect(screen.locator('.member-name-label', { hasText: 'Cloud Migration' })).not.toBeVisible();
    await expect(screen.locator('.member-name-label', { hasText: 'SOC 2 Compliance' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 10. All Tags — discussion tag filter
// ---------------------------------------------------------------------------

test.describe('All Tags — discussion tag filter', () => {
  test('DEV filter restricts tag counts to DEV-discussion entries', async ({ app }) => {
    await app.screen('allTags');
    const screen = app.page.locator('#allTagsScreen');

    // "kickoff" tag only appears in Cloud Migration (DEV)
    const kickoffRowAll = screen.locator('.tag-row', { hasText: 'kickoff' });
    await expect(kickoffRowAll).toBeVisible();

    await clickTagFilter(app.page, 'People');
    // "kickoff" is not used in People discussions — should not appear
    await expect(screen.locator('.tag-row', { hasText: 'kickoff' })).not.toBeVisible();

    await clickTagFilter(app.page, 'DEV');
    // "kickoff" reappears
    await expect(screen.locator('.tag-row', { hasText: 'kickoff' })).toBeVisible();
  });

  test('All button resets tag counts to full corpus', async ({ app }) => {
    await app.screen('allTags');
    await clickTagFilter(app.page, 'DEV');
    await clickTagFilter(app.page, 'All');
    // both DEV and People tags visible
    const screen = app.page.locator('#allTagsScreen');
    await expect(screen.locator('.tag-row', { hasText: 'kickoff' })).toBeVisible();
    await expect(screen.locator('.tag-row', { hasText: 'checkin' })).toBeVisible();
  });
});
