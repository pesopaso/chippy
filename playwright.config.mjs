// SPDX-License-Identifier: Apache-2.0
//
// Playwright config for Chippy's E2E phases (content creation + operate).
//
// Tests are namespaced per app under tests/<app>/. Today there is one app —
// `local` (src/local) — and it is expressed as a dedicated Playwright PROJECT
// named "local" with its own testDir. A future app adds another folder under
// tests/ and another project entry here (giving each its own webServer if its
// origin differs); select one with `playwright test --project=local`.
//
// Chippy needs an http(s)/localhost origin (ES modules + File System Access API),
// so `webServer` serves src/local exactly the way serve.cmd does. Execution is
// forced serial — the create/operate specs share one seed folder on disk
// (CHIPPY_SEED_DIR), so parallel workers would collide on it.

import { defineConfig } from '@playwright/test';

const PORT = process.env.CHIPPY_PORT ?? '8000';

export default defineConfig({
  fullyParallel: false,   // specs run in order, not in parallel
  workers: 1,             // single worker -> strict serial execution
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'line',

  // The app is fast, so a 3s action/assertion timeout is always sufficient for a
  // real interaction; test-first specs (features not built yet) then fail in ~3s
  // instead of stalling. The overall test timeout stays higher only so the
  // one-time fixture setup (app boot + OPFS seed) is never killed.
  timeout: 15_000,
  expect: { timeout: 3_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 3_000,
    navigationTimeout: 10_000,
    trace: 'on-first-retry',
    // Fixed timezone so the injected deterministic clock yields stable,
    // golden-comparable timestamps regardless of the host machine.
    timezoneId: 'UTC',
    // Experimental web-platform features enable the File System Access API in
    // headless Chromium for the seed/round-trip tests.
    launchOptions: { args: ['--enable-experimental-web-platform-features'] }
  },

  // Dedicated per-app marker: the "local" project owns the src/local test set.
  projects: [
    {
      name: 'local',
      testDir: 'tests/local/e2e',
      use: { browserName: 'chromium' }
    }
  ],

  webServer: {
    command: `python -m http.server ${PORT} --directory src/local`,
    url: `http://localhost:${PORT}/app.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
