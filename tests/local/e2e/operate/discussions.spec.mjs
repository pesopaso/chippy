// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — discussion management (sidebar / header): create + rename.
// Discussion tag editing/filtering lives in discussion-tag-filter.spec.mjs.
//
// NOTE: registration is verified via the sidebar (the UI reflects the nav,
// whatever file backs it) and the discussion .md, not navigation.md directly —
// the taxonomy refactor no longer keeps navigation.md in the data folder.

import { test, expect } from '../fixtures/operate.mjs';

test.describe('Discussion management', () => {
  // REAL: the sidebar "+" (#btnNewDiscussion) calls store.createDiscussion('New Discussion'),
  // which creates a placeholder-named discussion and opens it (the user then renames).
  test('create a new discussion from the sidebar', async ({ app }) => {
    await app.page.locator('#btnNewDiscussion').click();

    await expect.poll(() => app.readDiscussion('New Discussion')).not.toBeNull();   // file created
    await expect(app.page.locator('#sidebar .sidebar-body')).toContainText('New Discussion'); // listed
  });

  // REAL: inline title edit — ✎ .rename-btn -> input.rename-input -> Enter.
  // store.renameDiscussion -> io.renameDiscussion renames <name>.md AND moves the
  // per-discussion image folder.
  test('edit the discussion title — renames the .md file and the image folder', async ({ app }) => {
    const oldName = 'Cloud Migration';
    const newName = 'Cloud Strategy';
    await app.open(oldName);

    // Give the discussion an image folder so the folder-rename is exercised.
    await app.page.evaluate(async (dir) => {
      const root = await navigator.storage.getDirectory();
      const sub = await root.getDirectoryHandle(dir, { create: true });
      const w = await (await sub.getFileHandle('pic.jpg', { create: true })).createWritable();
      await w.write(new Uint8Array([255, 216, 255, 217])); await w.close();
    }, oldName);

    await app.page.locator('.rename-btn').click();
    const input = app.page.locator('input.rename-input');
    await input.fill(newName);
    await input.press('Enter');

    const has = (path) => app.page.evaluate(async (p) => {
      const parts = p.split('/'); const fname = parts.pop();
      let dir = await navigator.storage.getDirectory();
      try { for (const s of parts) dir = await dir.getDirectoryHandle(s); await dir.getFileHandle(fname); return true; }
      catch { return false; }
    }, path);

    // .md renamed (new present, old gone)
    await expect.poll(() => app.readDiscussion(newName)).not.toBeNull();
    await expect.poll(() => app.readDiscussion(oldName)).toBeNull();
    // image folder moved with it
    await expect.poll(() => has(`${newName}/pic.jpg`)).toBe(true);
    await expect.poll(() => has(`${oldName}/pic.jpg`)).toBe(false);
    // and the sidebar shows the new title
    await expect(app.page.locator('#sidebar .sidebar-body')).toContainText(newName);
  });
});
