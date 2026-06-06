// SPDX-License-Identifier: Apache-2.0
//
// Phase 2 — content creation. Seeds the full-spectrum dataset FROM ZERO through
// the app's real store write-path, leaving Markdown in seedDir for Phases 3-4.
//
// Flow:
//   1. Initiation batch writes the initial folder skeleton to seedDir (the app
//      can't bootstrap an empty folder yet).
//   2. The app loads; the skeleton is mirrored into OPFS (the app's test data
//      folder); deterministic clock/RNG + the OPFS handle are injected via the
//      guarded window.__chippyTest seam.
//   3. store.openFolder() opens it (bypassing the OS picker), then runDriver
//      creates every comment / task state / goal / action through real store
//      actions — exercising format.js + io.js.
//   4. OPFS is exported back to seedDir for the validator.
//
// Because the run is deterministic (fixed epoch + seeded PRNG, TZ=UTC from the
// Playwright config), the output is byte-reproducible and Phase 4 can golden it.

import { test, expect } from '../fixtures/seed-folder.mjs';
import { DATASET, DISCUSSION_NAMES, runDriver } from '../fixtures/dataset.mjs';
import { createSkeleton } from '../fixtures/init-folder.mjs';
import { importDirToOPFS, exportOPFSToDir } from '../fixtures/opfs-bridge.mjs';
import { rmSync, mkdirSync, readdirSync } from 'node:fs';

const EPOCH_MS = Date.UTC(2026, 0, 5, 9, 0, 0); // matches fixtures/seeded-rng.mjs SEED_EPOCH (UTC)
const RNG_SEED = 0xC419CD;

test.describe.serial('content creation — seed dataset from zero', () => {
  test('seed the full-spectrum dataset through the app', async ({ page, seedDir }) => {
    // 1 — initiation batch: the initial folder skeleton.
    rmSync(seedDir, { recursive: true, force: true });
    mkdirSync(seedDir, { recursive: true });
    createSkeleton(seedDir, DISCUSSION_NAMES);

    // 2 — load the app, mirror skeleton into OPFS, inject deterministic hooks.
    await page.goto('/app.html');
    await expect(page.locator('#topChrome')).toBeVisible();
    await importDirToOPFS(page, seedDir);

    await page.evaluate(async ({ epoch, seed }) => {
      // mulberry32 inlined (page scope has no imports).
      let a = seed >>> 0;
      const rng = () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
      let t = epoch;
      window.__chippyTest = {
        dirHandle: await navigator.storage.getDirectory(),
        now: () => { const d = new Date(t); t += 60000; return d; },
        rng
      };
    }, { epoch: EPOCH_MS, seed: RNG_SEED });

    // 3 — open the folder (test seam) and drive the dataset through the store.
    await page.evaluate(async () => { await window.Chippy.store.openFolder(); });
    const summary = await page.evaluate(runDriver, DATASET);
    expect(summary.discussions).toBe(DISCUSSION_NAMES.length);
    expect(summary.entries).toBeGreaterThan(0);

    // 4 — export the app's OPFS output back to disk for Phase 4.
    await exportOPFSToDir(page, seedDir);

    // Sanity: every discussion file plus the index trio landed on disk.
    const onDisk = readdirSync(seedDir);
    for (const name of DISCUSSION_NAMES) expect(onDisk).toContain(name + '.md');
    for (const idx of ['navigation.md', 'tags.md', 'names.md']) expect(onDisk).toContain(idx);
  });
});
