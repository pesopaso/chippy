# Chippy — Code & Documentation Assessment

**Date:** 2026-09-02
**Revision analysed:** `61284f0` (branch `staging`, v3.3.0-dev.9 per changelog; 8 commits ahead of `main` / v3.2.0)
**Scope:** everything in `Chippy_Staging` — the nine application scripts in `src/local/`, the documentation set, the unit / e2e / data test apparatus, the regression harness, the release scripts and workflow, and the project-level design notes. The previous assessment (`CodeAssessment.md`, 2026-06-07, rev `c65e458`) is used as the baseline to measure what changed.

**Method.** Every application file and every documentation file was read in full. Claims below were verified against the source, and where a defect is reported it was reproduced (unit suite, regression harness and data validator were executed on the checkout; the two format-level defects were reproduced with `format.js` under Node). Nothing in the working tree was modified.

---

## 1. Executive summary

Chippy is in good shape for what it is: a deliberately dependency-free, build-free, single-user notebook that stores everything as Markdown in a folder the browser is granted access to. The architecture described in `target-architecture.md` is real — the code honours the one-way layering (format → io → store → ui → screens → main) with only a couple of small leaks, the one write-path discipline (every mutation is a `store` action that persists and emits) is followed consistently, and the on-disk format is simple enough that a human or another tool (the user's `dev-task-runner` skill, an AI writing into the folder) can read and write it. The June recommendation to centralise the tag taxonomy was executed well (`taxonomy.js`), and the feature set has grown substantially since — ideas, task links, sensitive markers, a calendar, an introduction template — with matching unit tests for the store-level logic (65/65 green).

The concerns are concentrated, not systemic, and most of them are cheap to fix:

1. **A silent regression has been live since 2026-06-02.** `scrollToEntry` looks for `.history-entry[data-entry-id]`, but the unified `entryCard` (dev.18) emits `.entry-card`. Every jump-to-comment feature — double-click on task/goal/idea rows, the goal ✎ button, and the cross-page double-click navigation shipped as dev.119 — resolves to nothing; the discussion opens but never scrolls or flashes. Three months of changelog entries describe a behaviour that does not execute.
2. **Two format-level data-integrity defects.** A `### ` line inside a comment body (a heading — which the help dialog advertises) splits the entry into two on the next load, the second half getting `created_at: "Sub heading"`. And the parser retains empty-body entries although `datadefinition.md` says they are dropped.
3. **Discussion-name collisions can overwrite files.** `createDiscussion` and `renameDiscussion` check uniqueness on the *display* name, not on the sanitized filename stem. "R&D" next to an existing "RD" silently overwrites `RD.md`.
4. **The byte-for-byte regression harness is red on a Windows checkout** — not because the format drifted, but because `.gitattributes` (`* text=auto eol=crlf`) checks the three newer `*.chippy.md` reference files out as CRLF while the serializer emits LF. The pin the README calls the "safety net" is currently failing where the author works.
5. **Version and release hygiene:** the runtime stamp is `3.3.0-dev.1` while the changelog is at dev.9, so the cache-busting `?v=` has not moved across eight shipped changes; there is no CI job that runs tests (the only workflow is the manual release); `src/local/__wtest.js` (700 lines of `// line N`) is tracked in git.
6. **Documentation drift** in the places a newcomer reads first: both READMEs still say `src/local` "is currently a scaffold", the tests README says the app "can't create discussions", `documentation.md` still describes the deployment and data folder from the v2 era, and several numeric claims (unit count 48 vs 65, R47 semantics) lag the code.

The June-era structural findings are half-addressed: taxonomy duplication is gone, but `ui.js::entryCard` grew from ~185 to ~350 lines and is now the single most complex function in the codebase; the four dead functions flagged in June are still present; the NUL-byte sentinel still lives in `mdInline`.

---

## 2. What Chippy is (as built, not as originally specified)

The spec's origin — a team lead's 1:1 notebook — is visible in the vocabulary (`member`, `checkin`, contribution export for HR reviews), but the product has generalised to "any long-running discussion". A folder holds one `<Name>.md` per discussion plus three `.chippy.md` indexes (navigation/tags/names) and an optional `summary.chippy.md`. Every entry is a timestamped, tagged Markdown block; reserved tags turn an entry into a task, followup, goal or idea and carry its state and priority. The UI is one authoring screen (description, composer, day-grouped history, right panel of open tasks / goals / ideas / links / images) plus thirteen cross-discussion pages (Comments, Tasks, Goals, Ideas, Links, Images, Names, Tags, Kanban, Calendar, Ro3, Activity, AI Summary).

Two newer capabilities deserve mention because they change the data model's shape. **Task links** (origin + reference model) let one task appear in several discussions with a single source of truth, and are the first feature that makes a discussion file depend on another file. **Sensitive markers** add a privacy boundary in front of the LLM summary. Both are well-specified in `datadefinition.md` §2.4 / §3.1 and both are unit-tested.

---

## 3. Architecture and code structure

### 3.1 Layering — holds up

| Script | Lines (Sep) | Lines (Jun) | Role |
|---|---:|---:|---|
| `store.js` | 1,275 | 761 | State, selectors, all mutations, persistence calls, search, links, summary I/O |
| `pages.js` | 1,090 | 587 | Router, sidebar, all cross pages, Kanban, Calendar, Ro3, AI Summary |
| `ui.js` | 1,049 | 527 | Sanitize boundary, Markdown, modals, autocomplete, the shared `entryCard` |
| `discussion.js` | 921 | 643 | The authoring screen, link resolution cache, right-panel rows |
| `main.js` | 600 | 415 | Bootstrap, theme, help/about, print, the single store subscriber |
| `dashboard.js` | 352 | 341 | Activity charts (hand-rolled SVG) |
| `io.js` | 346 | 261 | File System Access wrappers, index migration, image store |
| `format.js` | 259 | 246 | Pure parse/serialize (also loaded by Node tests) |
| `taxonomy.js` | 94 | — | Reserved tags, state machine, link-tag grammar |
| **Total** | **5,986** | **3,781** | +58 % in three months |

Dependencies point downward as documented. The exceptions are small and worth naming: `pages.openLinks` reads `store()._state.members` directly instead of using a selector (the `_state` export is documented as test-only), and `discussion.js` reaches into `Chippy.tags` and `store` in ways that are fine but make it the file that knows the most. `format.js` remains genuinely pure, which is what allows the Node harness and the 65 unit tests to exist without a browser.

### 3.2 State and reactivity

The single subscriber in `main.js` is the app's event bus. It grew to ~40 `case` labels but is now readable because the single-entry mutations are grouped and routed to `discussion.refreshEntry` (in-place card swap, scroll preserved) with a full `pages.refresh()` fallback. This is a sound pattern for a no-framework app; the cost is that every new event type has to be remembered here, and there is no test that a given store event reaches a re-render. The event-name string set is implicit — a typo in an emit or a case produces a silent no-render rather than an error.

Lazy loading, which the architecture doc and `datadefinition.md` §3 present as the reason the index files exist, is no longer what happens: `folderOpened` triggers `ensureAllLoaded()` in the background (for sidebar comment counts), and every cross page awaits it. The indexes are still useful (first paint before the loads finish, autocomplete without a scan), but the documents overstate the design constraint and a reader will make wrong assumptions about memory and I/O.

### 3.3 Complexity hot-spots

`ui.js::entryCard` (lines ~650–1000) now decides link state, kind, collapse, ten optional controls, image resolution, inline editing with a tag editor, paste handling and double-click routing in one closure. It is the function most likely to regress when a control is added (and the `history-entry` regression is exactly that kind of change). `store.js` at 1,275 lines mixes selectors, write rules, task/goal/idea state machines, linking, search, Ro3, summary persistence and export; the June suggestion to split it was not taken and it has grown 68 %. Neither is a crisis — the functions inside are small and pure where it matters — but both are past the point where a split (e.g. `store-links.js`, `store-search.js`, or `card.js` out of `ui.js`) pays for itself.

Duplicated logic that `taxonomy.js` did not absorb: the idea-state label/class ladder (`Considered/Explored/Promoted/Shelved`) is written out independently in `ui.js`, `discussion.js`, `pages.js` (`ideaStateOf`), `store.js` (`getIdeaState`) and `dashboard.js`; and the closed-task / closed-goal tag sets exist as constants in both `store.js` and `pages.js`. Moving `IDEA_STATES` and `CLOSED_*` next to `STATES` in `taxonomy.js` would finish the job started in June.

---

## 4. Data model and the format layer

### 4.1 Strengths

The format is genuinely simple and human-editable, the three-part body model (comment / `Updated:` / action log) is well thought out and the migration story (gen-1 single `navigation.md` → gen-2 split → `.chippy.md`) is handled once, defensively, with the dev.97 lesson (never blank a registry because a sibling file is missing) encoded as a comment and a test. CRLF tolerance (`normEol`) closes a real trap. The link-tag grammar (`<stem>:link-<id>`) is a clever way to get a cross-file identity that stays inside the existing `tags:` field and survives a plain-text edit.

### 4.2 Defects found (reproduced)

**Body lines starting with `### ` split the entry.** `parseDiscussion` treats every `### ` line after `## Entries` as a header. A comment containing a level-3 Markdown heading round-trips as two entries; the second gets `created_at = "Sub heading"` and inherits the rest of the body. Reproduced: serialize → parse yields 2 entries from 1. The help dialog explicitly lists `#`…`######` headings as supported. The same applies to `## Preparation` / `## Entries` lines inside a body, and to fenced code blocks containing `### `. Fix options: escape leading `#` in bodies on write (and unescape on read), or make the header regex stricter (`^### \d{4}-\d{2}-\d{2} `) — the latter is a one-line change and backward compatible since every real header starts with a timestamp.

**Empty-body entries are retained.** `datadefinition.md` §2: "An entry whose body is empty is not retained." The parser keeps them (reproduced: 2 of 2 retained). `addEntry` refuses an empty body, so the app never creates one, but an externally written or hand-edited file will surface empty cards. Either drop them in `parseDiscussion` or amend the spec.

**Sanitized-stem collisions overwrite files.** `sanitizeName` strips everything outside `[A-Za-z0-9_ -]`, so distinct display names can share a stem. `createDiscussion` de-duplicates on display names; `saveDiscussion` then writes `<stem>.md`, clobbering an existing file with the same stem. `renameDiscussion` has the same gap (`io.renameDiscussion` writes the new stem before removing the old, with no existence check). Additionally, `reconcileNavWithFiles` keys on stems, so after such a collision the nav will hold two entries for one file. Guard both actions with a stem-uniqueness check.

**Reserved tags accumulate in `tags.chippy.md`.** `ensureTagsInUnion` is called after every state/priority/mute/sensitive change with the entry's full tag list, so the union collects `resolvedtask`, `goal-xxxxx`, `<stem>:link-xxxxx`, `sensitive` and — worst — a fresh `muted:<date>` string for every mute (the reference data already contains `muted:2026-06-01`). The UI hides them via `RESERVED`, but the file grows unboundedly, the "N tags" status counter is wrong, and the spec's example (`tags.chippy.md` showing `goal`, `high`, `task`) suggests only kind/priority tags were meant to be there. Filter with `Chippy.tags.isReserved` before registering (and prune once on load).

### 4.3 Design risks (not defects, but worth a decision)

*Identity by timestamp.* `created_at` is the entry's identity. The dev.40 index hint mitigates same-second collisions for `setTaskState` and friends, but `moveEntry`, `deleteEntry` and `scrollToEntry` still match the first entry with that timestamp. `connectToDiscussion` writes reference entries with `nowISO()`, so connecting the same task to two discussions from a loop, or two tasks to one discussion within a second, produces duplicate identities. A monotonic tie-breaker (bump seconds until unique within the file) at write time would remove the class of bug.

*Moving a linked origin.* `moveEntry` transfers the entry to another discussion but does not rewrite its `<stem>:link-<id>` tag, so every reference to it breaks (the stem now names the wrong file) and, worse, the moved entry is now a *reference* by the discriminator rule (its stem ≠ the new discussion's stem) and disappears from the target's panels. Either refuse to move an origin that has references, or rewrite the tag on the origin and all references as `renameDiscussion` does.

*Non-atomic writes.* `writeFileText` truncates-then-writes through `createWritable()`. A crash or a OneDrive sync race mid-write can leave a zero-length discussion file with no backup. Given the folder is the only copy, a write-to-temp-then-rename (or keeping the last good copy as `<stem>.md.bak` inside a `.chippy/` subfolder) would be cheap insurance.

*Last-writer-wins with external tools.* The reload button is the answer to outside writers, but nothing detects that a file changed on disk between load and save; an AI appending to a discussion while it is open in Chippy will have its change overwritten by the next in-app mutation. Comparing the file's `lastModified` at save time and refusing (or merging) on mismatch is the minimal safeguard.

*Image orphans.* Pasting an image into the composer or the inline editor writes the JPEG immediately; cancelling the edit or clearing the draft leaves the file on disk with no reference. `URL.createObjectURL` results are never revoked outside the print path, so long sessions on image-heavy folders leak memory.

---

## 5. Verified functional regression: jump-to-comment

`discussion.js:121`:

```js
const div = document.querySelector('.history-entry[data-entry-id="' + id + '"]');
```

No script has emitted a `history-entry` class since commit `bff5dd6` (2026-06-02, dev.18 "Unified comment box everywhere"), which replaced the bespoke history row with `ui.entryCard` (`class="entry-card …"`). `git log -S'history-entry'` confirms the class was removed and the selector was not updated. Consequences, all silent (the function returns early):

- right-panel task/goal/idea double-click (R40) does nothing;
- the goal ✎ "edit" button no longer scrolls to or opens the entry;
- `pages.jumpToEntry` (dev.119, cross-page double-click) opens the discussion but never scrolls/flashes, which is easy to mistake for working;
- `.history-entry` rules in `style.css` (lines 376–463, including `.flash`) are dead CSS.

The fix is a one-token selector change (`.entry-card`), plus a Playwright assertion that the flashed card is in the viewport — the operate suite has no test for any jump behaviour, which is why this survived.

---

## 6. Security posture

The sanitize boundary is real: `innerHTML` appears exactly once in application code (`ui.safeSetHtml`), DOMPurify 3.2.6 is vendored, links are forced to `target=_blank rel=noopener` in an `afterSanitizeAttributes` hook, and `isSafeImagePath` rejects traversal, absolute paths, drive letters, schemes and NUL. The AI Summary name-redaction is a thoughtful addition.

Three things to tighten. `ALLOWED_ATTR` includes `style`; DOMPurify does not sanitize CSS values, so a pasted or externally written entry can carry `style="background:url(https://…)"` (a network beacon on render) or overlay styling. Nothing in the renderer emits inline styles, so dropping it costs nothing. `data-*` attributes (`data-name`, `data-tag`, `data-entry-id`) are allow-listed and could be attacker-controlled from a file, but no code reads them from rendered content, so this is latent only. And the AI Summary endpoint is user-configured with no scheme restriction; a `file:`-origin page can POST to any `http(s)` URL, which is by design but means a mistyped endpoint sends the (possibly un-redacted) notebook to it — a confirmation when the host is not `localhost`/`127.0.0.1` would be a reasonable guard.

---

## 7. Tests, harness and tooling

| Suite | Command | Result on this checkout |
|---|---|---|
| Unit (`node:test`) | `npm run test:local:unit` | **65 / 65 pass** (docs still say 48) |
| Regression harness | `node regressionharness/roundtrip.test.mjs` | **7 pass, 3 fail** — `names/navigation/tags.chippy.md` differ only by CRLF |
| Data validator | `npm run test:local:data` | 1 fail, 1 skipped — validating a stale July seed folder (pre-`.chippy.md` layout, on `D:`) |
| E2E create / operate (Playwright) | `npm run test:local:*` | not executed here (needs a Chromium install); README marks several specs "VERIFY" |

**Harness.** `git ls-files --eol` shows the older reference files stored/checked-out as `i/lf w/lf` (they predate `.gitattributes` and were never renormalized) while the three `*.chippy.md` files are `w/crlf`. So the "byte-for-byte pin" fails on every Windows clone and passes on Linux CI — which does not run it. Add `regressionharness/referencedata/** -text` (or `eol=lf`) to `.gitattributes` and renormalize; consider making the harness compare after `normEol` only as a fallback, never as the primary check, or the pin loses its meaning.

**Coverage shape.** The unit tests are well targeted at the write rules (linking, sensitive, EOL, migration, reload, paste-linkify, store helpers, ideas). What is missing is the presentation/event layer: nothing asserts that a store event leads to a DOM update, nothing covers `entryCard` option combinations, nothing covers the calendar's drag-to-reschedule or the introduction-template round-trip. The operate specs were "authored without a browser to run them" (README); whether they have since been run green is not recorded anywhere — a `tests/local/.tmp/runs/` folder from July exists but the pipeline's own results only land in that run's `Test Execution.md`.

**CI.** `.github/workflows/release.yml` is a careful, well-commented manual release pipeline (merge staging → main, stamp, tag, zip, GitHub Release, merge back, bump dev) and the auto-resolution of the two version-stamped files is sensible. But nothing runs `npm test` on push or before release; the release job will happily ship a red unit suite. A ten-line `test.yml` (checkout, `npm ci`, unit + harness + data) on push to `staging` is the single highest-leverage tooling change available.

**Version stamp.** `main.js` and `app.html` carry `3.3.0-dev.1`; the changelog has shipped dev.2 … dev.9 (calendar drag & drop, overdue columns, paste-to-link, etc.) without moving the stamp. Because cache-busting is the `?v=` string, a user who opened the app after dev.1 will keep stale CSS/JS until the next release. `stamp-version.mjs --check` cannot catch this because both files agree with each other; a check that the stamp matches the newest `### v…` heading in `changelog.md` would.

---

## 8. Documentation: what is right and what has drifted

The documentation set is unusually complete for a solo project: a product spec with a numbered requirements table (R1–R66), a target architecture, a 15-step build plan, an authoritative data definition, a 945-line changelog that records every increment with file-level detail, concept/implementation/status trilogies for ideas and task links, a color reference, an annotated UI overview, and a 46-task self-teaching introduction discussion generated from a single script. The changelog in particular is a model of how to keep a rewrite legible.

Drift, in order of how much it would mislead a reader:

- **`README.md`** ("Status: … `src/local/` is currently a scaffold") and **`src/local/README.md`** ("This folder is currently a scaffold") — both are three releases out of date. The top-level README also omits ideas, calendar, task links, sensitive markers and the introduction template from the highlights.
- **`tests/local/README.md`** — "The app is currently a scaffold: it can add entries to an existing discussion but can't create discussions or open an empty folder"; "toggleMute uses the real clock (not injectable)" is still true and worth keeping, the rest is stale. Also says nothing about the Windows CRLF failure.
- **`documentation.md`** — the Detailed Description still describes a Trello-replacement for "a team lead managing 15 direct reports", the `C:\Temp\Chippy\PeopleFiles` default folder (R16, R19 — the app has no default folder), "Thirteen cross-discussion views" then lists Calendar and Ideas inconsistently, R50 says the theme "persists in `navigation.md`" (the app only writes `localStorage`; `store.setTheme` and the `> theme:` field are read but never written), R59 lists print handlers per screen (print now renders the raw `.md` for the discussion screen only), and "Flask container version / SQLite" from the gate Q&A never materialised. The requirements table is the best asset here; the prose around it needs a pass.
- **`target-architecture.md`** and **`datadefinition.md` §3** — the lazy-loading rationale (see §3.2 above); the architecture doc also omits `taxonomy.js` from its module table and load order.
- **`implementation-plan.md`** — Step 12.3 still specifies Ro3 as "one per priority" (changed in dev.121); Step 8.2 still says DONE/OBSL write `Resolved:`/`Obsolete:` markers (retired in dev.90); Step 14 describes streaming (the fetch is `stream:false`).
- **Project doc `task-linking-status.md`** — "unit suite 48/48" (now 65), and its "Open follow-ups" list is still accurate (Playwright e2e for connect/sensitive/reload, sensitive entries in the manual contribution export).
- **`CodeAssessment.md`** (June) — should be dated in its filename or moved under `documentation/` now that there is a second one.
- **`app.html`** — the welcome screen literally says "Scaffold shell — screens are wired in later implementation steps."

---

## 9. Housekeeping

- `src/local/__wtest.js` — 700 lines of `// line N`, tracked in git (`git ls-files` confirms). The packager excludes it, but it should not be in the repo.
- `io.js.bak`, `store.js.bak` — ignored by `.gitignore` but still on disk; `io.js.bak` is the pre-`.chippy.md` version and is only confusing.
- `dist/chippy-3.0.0.zip`, `dist/chippy.zip` — ignored, stale.
- `COWORK_SYNC_CHECK.txt` at the repo root — tracked; a leftover probe file.
- `tests/local/.tmp/runs/latest.txt` points at a `D:\` path that no longer corresponds to this checkout.
- June's dead-code list is still dead: `discussion.js` `showMoveDialog`, `showDeleteDialog`, `entryKindClass`; `pages.js` `CLOSED_TASK`/`CLOSED_GOAL` duplicate the store's; `style.css` `.history-entry*` rules.
- `serve.cmd` header comment still claims "the app cannot run from a file:// double-click" — the opposite of what the README says.

---

## 10. Recommendations, in order

**Do first (each under an hour, high value):**

1. Fix the `scrollToEntry` selector (`.history-entry` → `.entry-card`) and add one operate test that double-clicks a right-panel task and asserts the card gains `.flash`.
2. Make the entry-header regex timestamp-anchored in `parseDiscussion` (`/^### \d{4}-\d{2}-\d{2} /`) so `###` headings in bodies stop splitting entries; add a unit test with a heading in the body. Decide on empty-body retention and align code or spec.
3. Add stem-uniqueness guards to `createDiscussion` and `renameDiscussion`.
4. Filter reserved tags out of `ensureTagsInUnion`/`registerMemberRefs`/`addEntry` registration and prune the union once on load.
5. Pin the harness data: `regressionharness/referencedata/** -text` in `.gitattributes`, renormalize, and re-run the harness on Windows.
6. Stamp `3.3.0-dev.9` (or whatever ships next) and add a changelog-vs-stamp consistency check to `stamp-version.mjs --check`.
7. Add a `test.yml` workflow running unit + harness + data on every push to `staging`, and make the release workflow depend on it.

**Do soon:**

8. Decide the "move a linked origin" rule and implement it (refuse, or cascade-rewrite the link tag).
9. Drop `style` from `ALLOWED_ATTR`; add a non-localhost confirmation on the AI Summary endpoint.
10. Give `moveEntry`/`deleteEntry` the index hint every other mutation has, or make `created_at` unique at write time.
11. Safer writes: temp-then-rename or a one-generation backup; `lastModified` check before overwrite.
12. Documentation pass on the three READMEs, `documentation.md`'s prose, and the implementation plan's stale steps; mention `taxonomy.js` in the architecture doc; update the lazy-loading rationale to what actually happens.

**When convenient:**

13. Split `entryCard` into builders (meta row, controls, body/images, inline editor) and `store.js` into two or three scripts along the existing section comments; move `IDEA_STATES` and the closed-tag sets into `taxonomy.js`.
14. Delete the dead code, `__wtest.js`, `.bak` files, the probe file and the dead CSS.
15. Revoke blob URLs on card teardown; defer image writes until the entry/edit is saved (or sweep orphans on folder load).
16. Adopt the ESLint gate proposed in June (it was not); it would have flagged the unused functions and the shadowed names.

---

## 11. Follow-through on the June 2026 assessment

| June recommendation | Status in September |
|---|---|
| Decompose `entryCard` and the `main.js` subscriber | Not done; `entryCard` roughly doubled. Subscriber grew but is better organised. |
| De-duplicate state classification / `HIDDEN_TAG` | **Done** — `taxonomy.js` is the single source; all modules alias it. |
| Remove dead code (`STATE_LABEL`, `showMoveDialog`, `showDeleteDialog`, `entryKindClass`, `.bak`) | `STATE_LABEL` gone; the three functions and both `.bak` files remain. |
| Replace NUL-byte sentinels | Partially — `mdInlinePlain` uses text placeholders; `mdInline` still uses NUL. |
| Adopt ESLint as a project gate | Not done. |
| Stop versioning generated output | `.gitignore` covers it; `__wtest.js` and `COWORK_SYNC_CHECK.txt` are the remaining tracked noise. |
| Consider splitting `store.js` | Not done; +68 % lines. |

---

*Assessment performed by reading all source and documentation in `Chippy_Staging` at `61284f0` and executing the unit suite, regression harness and data validator on the checkout. No files were modified.*
