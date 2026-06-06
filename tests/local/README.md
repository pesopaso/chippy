# Tests — `local` app (src/local)

Test apparatus for the `local` Chippy app. Tests are namespaced per app under
`tests/<app>/`; this is the first (`local`). The app stays build-free and
dependency-free — only this toolchain has dependencies (Playwright).

Run everything: `npm test` (or `npm run test:local`). Individual phases:
`npm run test:local:unit | test:local:create | test:local:operate | test:local:data`.

First-time setup on your machine: `npm install` then `npx playwright install chromium`.

## Four-phase pipeline (orchestrated by `run.mjs`)

1. **unit** (`unit/`, `node:test`) — pure logic in `format.js` / `store.js`.
   Zero-dependency, loaded via `_load.mjs`. Gates the run.
2. **e2e/create** (`e2e/create/`, Playwright) — seeds the full-spectrum dataset
   *from zero* through the app's real store write-path. Deterministic, so its
   output is byte-reproducible.
3. **e2e/operate** (`e2e/operate/`, Playwright) — drives the real UI over the
   seeded data (task/goal state, priority, activity, due across the discussion
   right column, kanban, All Tasks, Ro3; All Comments search/move/delete/edit;
   DOMPurify + path-traversal safety) via the operate harness, asserting changes
   persisted to the .md on disk.
4. **data** (`data/`, `node:test`) — a clean-room, spec-derived validator
   (`validator.mjs`, does NOT import `format.js`) checks the on-disk files
   against `documentation/datadefinition.md`.

## How content creation works (Phase 2)

The app is currently a scaffold: it can add entries to an existing discussion but
can't create discussions or open an empty folder. So creation is a hybrid:

- **Initiation batch** (`fixtures/init-folder.mjs`, pure Node) writes the initial
  folder skeleton — `navigation.md`, empty `tags.md`/`names.md`, and one empty
  discussion file per discussion. Runnable standalone:
  `node tests/local/e2e/fixtures/init-folder.mjs [dir]`.
- **The app** then fills in every comment, task state, goal and action through
  its real `store` actions (`fixtures/dataset.mjs` defines the dataset + driver).

Two supporting pieces:

- **Test seam** — a guarded `window.__chippyTest = { dirHandle, now, rng }` in
  `src/local` (io.js + store.js). It injects a directory handle to bypass the OS
  picker and a deterministic clock/PRNG. All three are undefined in production,
  so real users are unaffected.
- **OPFS bridge** (`fixtures/opfs-bridge.mjs`) — headless Chromium can't be given
  a real-disk folder without the picker, so the app's data folder in tests is the
  Origin Private File System. The bridge mirrors the skeleton disk→OPFS before the
  app opens it and exports OPFS→disk afterwards for Phase 4.

The **operate harness** (`fixtures/operate.mjs`) is the Phase 3 counterpart: it
boots the app, mirrors the seed into OPFS, opens the folder via the hook, and
exposes navigation/control/read-back helpers so the operate specs drive real DOM
controls and assert the resulting .md on disk.

`fixtures/node-seed.mjs` runs that same store write-path under Node (with an
fs-backed handle) — used to verify the dataset produces spec-valid output and to
capture a golden snapshot without a browser.

## Test run folders

Each `npm test` run gets its own timestamped folder so runs never clobber each
other and history is kept:

    tests/local/.tmp/runs/YYYY-MM-DD_hh-mm-ss_testrun/

`run.mjs` sets `CHIPPY_SEED_DIR` to that folder and shares it across all phases.
Alongside the runs it writes `latest.txt` (the path of the most recent run) and
prunes old runs, keeping the newest `CHIPPY_KEEP_RUNS` (default 10). Everything
lives under the gitignored `.tmp/`.

Pin a specific folder instead by setting `CHIPPY_SEED_DIR` before the run; then no
timestamped folder is created and that exact path is used (and cleared first).

## Gating rules (verified)

- Phases run in series; the seed folder on disk is the artifact passed between
  them. `run.mjs` wipes it at the start (zero-data precondition) and leaves it
  afterwards for inspection.
- The **data** phase runs whenever **create** produced at least one discussion
  file — even if a later phase failed. `CHIPPY_DATA_MODE` is `full` when create
  fully passed (structural + golden) or `partial` otherwise (structural only).
- The process still exits non-zero if any phase failed; running the data phase
  never masks an earlier failure.

## Golden snapshot

`data/golden/` is empty until you capture the deterministic create output once
and commit it; completeness comparison then activates automatically in `full`
mode. Capture it from a real browser run, or from the Node seeder:
`TZ=UTC node tests/local/e2e/fixtures/node-seed.mjs tests/local/data/golden`
(then remove the index/image files you don't want pinned).

## Test Execution discussion

The skeleton includes a meta-discussion, **Test Execution** (`Test Execution.md`),
added by the init batch. At the end of each run `run.mjs` appends:

- one **run-summary** entry — pipeline result, per-phase pass/skip counts and the
  run-folder name — tagged `testrun` + `passed`/`failed`; and
- one **per-test** entry — `[phase] <test name> — PASS/FAIL/SKIP` — tagged
  `testresult` + the result, for every test across all phases.

Per-test results are parsed from each runner's structured output: TAP for the
node:test phases (unit, data) and the Playwright JSON reporter for the e2e phases
(create, operate). Test names are neutralised so markup in a name (e.g. a
`@[Name]` reference) is not interpreted as content. This puts the full result
list directly inside the test dataset (and keeps tags.md consistent).

Because each run uses a fresh timestamped folder, each folder's Test Execution
discussion holds exactly that run's results; the history lives across run folders
(and `latest.txt`). The entry is appended after Phase 4, so the validator sees
the discussion empty during the run; the appended entry is written canonically
via format.js and is itself spec-valid. (A single log that accumulates across
runs would be a separate, persistent-file design — ask if you want that instead.)

## Known gaps

- `e2e/operate/*` are live but were authored without a browser to run them; the
  first real run may need selector/timing tweaks — most likely the kanban
  drag-drop and the inline comment-edit flow (marked VERIFY in comments.spec).
- `toggleMute` uses the real clock (not injectable), so mute is omitted from the
  deterministic dataset; add it once a clock seam covers it.
