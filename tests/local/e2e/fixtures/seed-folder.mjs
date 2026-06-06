// SPDX-License-Identifier: Apache-2.0
//
// Shared Playwright fixture: the on-disk seed folder that is the artifact passed
// between phases. The create phase writes it, the operate phase mutates it, and
// Phase 4 validates it. Its path comes from CHIPPY_SEED_DIR (set by the
// orchestrator); when a spec is run directly via `npm run test:create`, we fall
// back to tests/.tmp/seed.
//
// `test.extend` adds two fixtures:
//   seedDir  — absolute path to the seed folder (created if missing)
//   appPage  — a page already navigated to the app on the local server
//
// OPEN WIRING TASK (the one real piece left for the E2E phases):
// Chippy opens a folder through the File System Access API (showDirectoryPicker).
// Headless Chromium can grant this, but the OS picker can't be clicked from
// Playwright, so the app needs a tiny *test-only* entry point — e.g. a
// window.__chippyTestOpenDir(handle) hook, or reading a directory handle the
// harness injects — that bypasses the picker and hands the app a handle rooted
// at seedDir. Build that hook behind a flag that never ships in production, then
// the specs below stop being fixme and drive the real app.

import { test as base, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SEED_DIR =
  process.env.CHIPPY_SEED_DIR ??
  join(process.cwd(), 'tests', 'local', '.tmp', 'seed');

export const test = base.extend({
  seedDir: async ({}, use) => {
    mkdirSync(SEED_DIR, { recursive: true });
    await use(SEED_DIR);
  },

  appPage: async ({ page }, use) => {
    await page.goto('/app.html');
    await expect(page.locator('#topChrome')).toBeVisible();
    // TODO(wiring): hand the app a directory handle rooted at seedDir via the
    // test-only hook described above, then wait for the folder-ready state.
    await use(page);
  }
});

export { expect };
export const seedDirPath = SEED_DIR;
