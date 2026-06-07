// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — discussion management (sidebar / header): create + rename.
// Discussion tag editing/filtering lives in discussion-tag-filter.spec.mjs.

import { test, expect } from '../fixtures/operate.mjs';

test.describe('Discussion management', () => {
  // REAL: the sidebar "+" (#btnNewDiscussion) calls store.createDiscussion('undefined'),
  // which creates a placeholder-named discussion and opens it (the user then renames).
  test('create a new discussion from the sidebar', async ({ app }) => {
    await app.page.locator('#btnNewDiscussion').click();

    // a discussion named "undefined" is created, registered, and listed
    await expect.poll(() => app.readDiscussion('undefined')).not.toBeNull();
    await expect.poll(() => app.readFile('navigation.md')).toContain('undefined');
    await expect(app.page.locator('#sidebar .sidebar-body')).toContainText('undefined');
  });

  // REAL: inline title edit — ✎ .rename-btn -> input.rename-input -> Enter.
  // store.renameDiscussion -> io.renameDiscussion renames <name>.md AND moves the
  // per-discussion image folder, and updates navigation.md.
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

    await expect.poll(() => app.readDiscussion(newName)).not.toBeNull();
    await expect.poll(() => app.readDiscussion(oldName)).toBeNull();
    await expect.poll(() => has(`${newName}/pic.jpg`)).toBe(true);
    await expect.poll(() => has(`${oldName}/pic.jpg`)).toBe(false);
    await expect.poll(() => app.readFile('navigation.md')).toContain(newName);
  });
});
