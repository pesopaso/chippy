// SPDX-License-Identifier: Apache-2.0
//
// Operate harness — the fixture the Phase 3 (operate) specs run on.
//
// It boots the app, mirrors the on-disk seed into OPFS, injects the guarded
// window.__chippyTest hooks (OPFS dir handle + deterministic clock/RNG), and
// opens the folder through the real "Open Folder" button (the hook bypasses the
// OS picker). It then exposes `app`, a small API of navigation, control, and
// read-back helpers grounded in the app's actual DOM (discussion.js / pages.js /
// ui.js). Assertions read the discussion .md back from OPFS — the authoritative
// check that a UI action persisted.
//
// Each test gets a fresh context, so it re-imports the pristine seed into its own
// OPFS; mutations never leak between tests. Selectors reference real classes:
//   right-column task row  .task-item   goal row  .goal-item
//   cross-view card        .entry-card  kanban card .kanban-card / col .kanban-col
//   state dropdown         .state-dropdown .state-option   priority .prio-square
//   due input  input.task-due   activity ⚡ .icon-btn.act   modal .modal/.modal-input
//   cross-view search  input.list-search   member label .member-name-label

import { test as base, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { importDirToOPFS } from './opfs-bridge.mjs';

const SEED_DIR = process.env.CHIPPY_SEED_DIR ?? join(process.cwd(), 'tests', 'local', '.tmp', 'seed');
const sanitize = n => String(n).replace(/[^A-Za-z0-9_ -]/g, '');

export const test = base.extend({
  app: async ({ page }, use) => {
    mkdirSync(SEED_DIR, { recursive: true });
    await page.goto('/app.html');
    await expect(page.locator('#topChrome')).toBeVisible();

    await importDirToOPFS(page, SEED_DIR);
    await page.evaluate(async ({ epoch, seed }) => {
      let a = seed >>> 0;
      const rng = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let t = epoch;
      window.__chippyTest = {
        dirHandle: await navigator.storage.getDirectory(),
        now: () => { const d = new Date(t); t += 60000; return d; },
        rng
      };
    }, { epoch: Date.UTC(2026, 5, 1, 12, 0, 0), seed: 0xABCDEF });

    await page.locator('#btnOpenFolder').click();
    await expect(page.locator('#sidebar .sidebar-body')).toContainText('Maria Lopez', { timeout: 10000 });

    const api = {
      page,
      // --- navigation ---
      async open(name) {                       // open a discussion (member view + right column)
        await page.evaluate(n => window.Chippy.store.selectMember(n), name);
        await expect(page.locator('#main .screen.active')).toBeVisible();
      },
      async screen(name) {                     // open a cross-view (allComments/allTasks/kanban/ro3/...)
        await page.locator(`.nav-btn[data-screen="${name}"]`).click();
      },
      // --- row locators ---
      taskRow(text) { return page.locator('.task-item', { hasText: text }).first(); },
      goalRow(text) { return page.locator('.goal-item', { hasText: text }).first(); },
      card(text) { return page.locator('.entry-card', { hasText: text }).first(); },
      // --- controls (operate on a row locator) ---
      async chooseState(row, label) {
        await row.locator('.state-square').first().click();
        await page.locator('.state-dropdown .state-option', { hasText: new RegExp('^' + label + '$') }).click();
      },
      async clickPriority(row) { await row.locator('.prio-square').first().click(); },
      async setDue(row, date) {
        const d = row.locator('input.task-due').first();
        await d.fill(date); await d.dispatchEvent('change');
      },
      async addAction(row, text) {
        // Task rows use .icon-btn.act, goal rows use a plain .icon-btn — match the ⚡ glyph.
        await row.locator('.icon-btn', { hasText: '⚡' }).first().click();
        await page.locator('.modal-input').fill(text);
        await page.locator('.modal-actions .btn-primary', { hasText: 'Add' }).click();
      },
      async achieveGoal(row) { await row.locator('.icon-btn.done').first().click(); },
      async cancelGoal(row) { await row.locator('.icon-btn.cancel').first().click(); },
      async moveComment(row, target) {
        await row.locator('.icon-btn', { hasText: '➜' }).first().click();
        await page.locator('.modal select.modal-input').selectOption(target);
        await page.locator('.modal-actions .btn-primary', { hasText: 'Move' }).click();
      },
      async deleteComment(row) {
        await row.locator('.icon-btn', { hasText: '🗑' }).first().click();
        await page.locator('.modal-actions .btn-primary.danger', { hasText: 'Delete' }).click();
      },
      async search(text) {                     // type into the active cross-view search bar
        const inp = page.locator('#main .screen.active input.list-search').first();
        await inp.fill(text);
      },
      async dragToColumn(cardText, colLabel) { // kanban drag-drop
        const card = page.locator('.kanban-card', { hasText: cardText }).first();
        const col = page.locator('.kanban-col', { has: page.locator('.kanban-col-header', { hasText: new RegExp('^' + colLabel + '$') }) }).first();
        await card.dragTo(col);
      },
      // --- read-back ---
      async readDiscussion(name) {
        return await page.evaluate(async (fn) => {
          const root = await navigator.storage.getDirectory();
          try { const fh = await root.getFileHandle(fn); return await (await fh.getFile()).text(); } catch { return null; }
        }, sanitize(name) + '.md');
      }
    };

    await use(api);
  }
});

export { expect };
