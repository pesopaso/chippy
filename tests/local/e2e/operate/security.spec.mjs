// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — safety boundaries. The highest-value e2e checks: the real DOMPurify
// render boundary and the image-path guard, which no pure-logic test substitutes.

import { test, expect } from '../fixtures/operate.mjs';

test.describe('safety boundaries', () => {
  test('DOMPurify strips script / event-handler payloads from rendered entries', async ({ app }) => {
    await app.open('1-1 Maria Lopez');
    await app.page.evaluate(async () => {
      await window.Chippy.store.addEntry('1-1 Maria Lopez',
        { text: 'XSS probe <img src=x onerror="window.__xss=1"> <script>window.__xss=1<\/script>' });
    });
    await app.page.waitForTimeout(150); // allow re-render + sanitize
    expect(await app.page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await app.page.locator('#main script').count()).toBe(0);
  });

  test('image path traversal is rejected by the path guard', async ({ app }) => {
    const url = await app.page.evaluate(() => window.Chippy.store.getImageUrl('../escape.jpg'));
    expect(url).toBeNull();
  });
});
