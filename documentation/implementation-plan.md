# Chippy — Implementation Plan

A sequential, 15-step plan to build chippy to feature parity with the MVP, organized around the
[target architecture](target-architecture.md) and driven by the requirements list and change log
in `notebook/documentation.md`. The data format is frozen by [datadefinition.md](datadefinition.md)
and the [regression harness](../regressionharness/README.md).

## How to use this plan

- **Steps are sequential.** Do not start a step until the previous one's acceptance criteria all
  pass. Each step builds on a working, manually verified base.
- **Every step ends with a manual test.** The acceptance criteria are the manual test script —
  run them in the browser (Chrome/Edge) against a real data folder before moving on.
- **The regression harness runs at every step that touches `format.js` or `io.js`.** `node roundtrip.test.mjs`
  must stay green.
- Requirement numbers (e.g. R20) refer to the requirements list; version tags (e.g. v1.26) refer
  to the change log, given as the historical origin of a feature for context.

---

## Step 1 — Project scaffold and app shell

**Substeps**
1.1 Create the chippy app files: `app.html`, `style.css`, and a classic-script entry `main.js`; vendor DOMPurify flat at the app root (`dompurify.min.js`). Scripts are classic (no ES modules) so the app runs from `file://`; each attaches to a global `Chippy` namespace and `app.html` loads them with ordered `<script>` tags. No subfolders for application code.
1.2 Define all colors as CSS variables, taking the palette from `chippy-color-reference.html` (the canonical color reference) for both dark and light modes; add the light/dark theme via `:root[data-theme=light]` (R50).
1.3 Build the top chrome bar (36px): app title, theme toggle, help button, print-button placeholder (R56).
1.4 Add cache-busting version query params on CSS/JS links and a single `VERSION` constant (R48, v2.8).
1.5 Create the flat classic scripts (`format.js`, `io.js`, `store.js`, `ui.js`, `discussion.js`, `pages.js`, `dashboard.js`) as stubs, each an IIFE attaching an empty object to its `Chippy.<name>` slot. All scripts sit at the app root — no module subfolders.
1.6 Licensing: the project is Apache-2.0. Keep `LICENSE` and `NOTICE` at the repo root; add an `// SPDX-License-Identifier: Apache-2.0` header to each source file; bundle the third-party license/notice files for DOMPurify (Apache-2.0 / MPL-2.0) and the Roboto font (Apache-2.0) alongside them.

**Acceptance criteria**
- App opens in Chrome/Edge directly from `file://` (no server) with no console errors; the shell renders.
- Theme toggle flips light/dark; all surfaces recolor via variables (no hard-coded colors).
- Version constant is visible (e.g. in the title or help) and bumping it busts the CSS/JS cache.
- `LICENSE` + `NOTICE` are present at the root, every source file carries the SPDX header, and DOMPurify and Roboto ship with their own license notices.

---

## Step 2 — Format layer: `format.js` (pure transforms)

**Substeps**
2.1 Implement discussion `parse`/`serialize` in `format.js`, matching the frozen format exactly.
2.2 Add navigation, tags, names, and summary parse/serialize to `format.js`.
2.3 Implement the legacy migration in `format.js`: read inline `## Tags` / `## Names` from `navigation.md` when the split files are absent (datadefinition §3.4).
2.4 Wire the regression harness `adapter.mjs` to the real `format.js` transforms and set `IMPLEMENTED = true`, so the suite tests production code (the harness ships with no implementation of its own).

**Acceptance criteria**
- `node regressionharness/roundtrip.test.mjs` passes against the real `format.js` transforms.
- A legacy single-file `navigation.md` (with `## Tags`/`## Names`) parses into discussions + tags + names with no data loss.
- `format.js` imports nothing from `io.js` (the pure transforms run in Node).

---

## Step 3 — Persistence layer: `io.js` (File System Access)

**Substeps**
3.1 `io.js`: open folder (readwrite), list discussions (skip `*.archive.md` and reserved files), load/save a discussion.
3.2 Read/write the index files; on load, run the legacy migration and write `tags.md` / `names.md`, rewriting `navigation.md` without the inline sections.
3.3 Image store: `saveImage` (paste → JPEG → `yyyy-mm-dd hh-mm-ss.jpg`), `moveImage`, `deleteImage`, `getImageUrl`, all behind `isSafeImagePath` (R12, R17, R36, R58).
3.4 Filename sanitization to `[A-Za-z0-9_ -]` on every read/write.

**Acceptance criteria**
- Opening a real folder lists every active discussion; archived files are excluded.
- Opening a legacy folder migrates it to the three-file layout once; the discussion content is untouched.
- Saving a discussion round-trips through the harness format; reopening shows identical content.
- An image path containing `..`, a leading separator, or a drive letter is rejected.

---

## Step 4 — Store: single source of truth

**Substeps**
4.1 Define the state object (`nav`, `tags`, `names`, `members` map (lazy), `activeMemberName`, `activeScreen`, `ui`).
4.2 Implement the event emitter (`subscribe`/`emit`) and core selectors (`getDiscussions`, `getActiveMember`, `getOpenTasks`, `getGoals`, `getTagUnion`, `getNames`).
4.3 Implement `openFolder()` (hydrate nav/tags/names, no discussion bodies) and `selectMember(name)` (lazy-load one file, cache, emit).

**Acceptance criteria**
- After `openFolder`, the store holds discussions/tags/names but `members` entries are still `null` (lazy) — confirmed in a console/debug dump.
- `selectMember` loads exactly one file; selecting a second does not re-read the first.
- A subscriber callback fires on `openFolder` and on each `selectMember`.

---

## Step 5 — UI controls foundation (render + sanitize)

**Substeps**
5.1 In `ui.js`, the single `safeSetHtml(el, html)` wrapping DOMPurify with the tag/attr/URI allowlist (R58).
5.2 In `ui.js`, `renderEntryText` (markdown + inline images + `@[Name]` chips + URL links) routed only through `safeSetHtml`.
5.3 In `ui.js`, a bottom-right transient toast (3s) (v2.42-era behavior).

**Acceptance criteria**
- An entry body with bold/lists/links/an image reference renders correctly.
- An injected `<script>` / `onerror` payload in entry text is stripped (manual XSS probe).
- No `innerHTML` assignment exists outside `safeSetHtml` (grep check).
- `showToast` appears and auto-dismisses.

---

## Step 6 — Discussion screen skeleton + navigation

**Substeps**
6.1 Sidebar: discussions grouped by tag, favorites sorted to top with a star, recent bar, and the discussion search box with clear button (R42, R43, favorites).
6.2 The router in `pages.js` (`showScreen(name)`); selecting a discussion shows the discussion screen with auto-focus on input (R1).
6.3 Member header (title, favorite star, reload-from-disk ↻ button) (R52, v2.12).
6.4 Preparation area: rendered markdown ↔ edit textarea, Enter saves / Shift+Enter newline (R7, R25).
6.5 Sidebar avatar initials: multi-word names take the first letter of each word, up to 3 ("John David Smith" → "JDS"); single-word names take the first character plus up to two subsequent uppercase letters ("MacDonald" → "MD", "ABCtest" → "ABC"); underscores count as word separators ("some_project" → "SP").

**Acceptance criteria**
- Sidebar lists discussions grouped by tag; favorites pinned with a star; search filters live; clear resets.
- Selecting a discussion focuses the entry input immediately.
- Reload button re-reads the file from disk and reflects an external edit without losing screen state.
- Preparation renders as markdown and round-trips through edit/save.
- Avatars show the expected initials for multi-word, single-word-with-uppercase, and underscore-separated names.

---

## Step 7 — Entry input and the write pipeline

**Substeps**
7.1 Tag-chip input with `#` autocomplete (suggest from tag union, create on the fly) (R3); `@` autocomplete for names (R54).
7.2 `store.addEntry`: apply write rules — `@word`→lowercased tag, URL auto-link, `@[Name]` literal, mint `goal-<id>` for goals, link selected goal, auto-add `low` priority for task/followup/goal, timestamp with seconds.
7.3 Goal-link dropdown and due-date picker on the input (R4, R28).
7.4 History rendering grouped by day, oldest-to-newest, with reserved-tag visual markers and multi-line expand indicator (R6, R31).
7.5 Draft autosave to `localStorage` (300ms debounce), silent restore on reopen, orphan cleanup (R53).

**Acceptance criteria**
- Typing `#tag ` extracts a chip; a new tag is added to the union and persisted to `tags.md`.
- Saving a goal entry mints a unique `goal-<id>`; a comment linked to that goal carries the same tag and the `goal:` header field.
- A pasted bare URL becomes a Markdown link on save; an `@[Name]` stays literal and the name is registered.
- New entries appear in the correct day group; reopening mid-edit restores the draft silently.
- The saved file passes the regression harness format.

---

## Step 8 — Task and followup management

**Substeps**
8.1 Right-panel Open Tasks list (priority-sorted) with markdown text (R11, R34, R5).
8.2 State dropdown with all seven states; `setTaskState` strips old state tags, adds one, and appends `Resolved:`/`Obsolete:` markers where applicable (R20, v1.26).
8.3 Priority dots (click to cycle) and due-date controls and age indicator (R21, R28).
8.4 Action modal (⚡) appending `- YYYY-MM-DD : <text>` under the single `Task Resolution Actions` section (R23).
8.5 Followups share the state/priority system; resolved followup uses `resolvedfollowup` (R27).
8.6 Resolved/obsolete hidden from lists but shown collapsed in history with expand (R11, v1.24).
8.7 Task muting: a mute/unmute toggle on the right-panel task list, All Tasks, Kanban, and Ro3 writes a `muted:<YYYY-MM-DD>` tag whose encoded date is a 5-day auto-expiry (datadefinition §2.2). Muted tasks render at reduced opacity, sort to the bottom of every task view, auto-unmute on render once the expiry date has passed, and are excluded from Ro3 candidate selection.

**Acceptance criteria**
- All seven states are selectable; DONE/OBSL write the matching tag and marker; the file matches the harness format.
- Priority cycles high→medium→low and persists; due date sets and changes inline; age shows days since creation.
- The action modal appends a dated bullet and consolidates into one actions section.
- A resolved task leaves the task list and appears collapsed in history.
- Muting a task writes `muted:<+5 days>`, drops it to the bottom of the list at reduced opacity, and removes it from Ro3; it auto-unmutes once the encoded date passes.

---

## Step 9 — Goal management

**Substeps**
9.1 Right-panel Goals list with action (⚡), edit, achieved, canceled controls (R39).
9.2 `achievedgoal` / `canceledgoal` transitions with `Achieved:` / `Canceled:` markers (datadefinition §2.2).
9.3 Edit button scrolls to the goal entry in history and opens edit; double-click on task/goal text jumps to the comment (R40).
9.4 Automatic goal linking trail via the `goal-<id>` tag across linked comments (R4).

**Acceptance criteria**
- Marking a goal achieved/canceled writes the right tag + marker; the goal leaves the open list.
- The goal's edit button scrolls to and opens its history entry; double-click navigation works for both tasks and goals.
- Every comment linked to a goal carries that goal's `goal-<id>` tag.

---

## Step 10 — Images, gallery, and links

**Substeps**
10.1 `Ctrl+V` image paste in the entry input → saved JPEG + inline markdown reference (R12).
10.2 Gallery in the right panel; full-screen image overlay with prev/next carousel navigation — Left/Right arrow keys (and on-screen prev/next buttons) step through the images with a position counter; clicking the background or pressing Escape closes, while clicking the image itself does not.
10.3 Per-discussion Links panel: extract URLs from entries and prep, dedup, inline title editing (R31, R44).
10.4 Image transfer + reference rewrite when moving a comment between discussions (R29, R36).

**Acceptance criteria**
- Pasting an image saves a dated JPEG in the discussion subfolder and renders it inline.
- The full-screen overlay steps between images with Left/Right arrow keys and shows a position counter; Escape or a background click closes it.
- The links panel lists deduped links from entries and prep; renaming a link rewrites the source entry.
- Moving a comment with an image moves the file and rewrites the reference; deleting a comment with an image deletes the file.

---

## Step 11 — Cross-discussion list pages + unified search

**Substeps**
11.1 Implement Comments, Tasks (list), Goals, Names, Links, Images pages, each `render(container)` reading the store (R30, R33 list parts, R55).
11.2 Shared unified search control: `#tag` → tag filter, `@Name`/`@[Full Name]` → name filter, remainder → freetext; clear (×) buttons; `#`/`@` autocomplete (R57, R35).
11.3 All Names: mention counts, last-seen, per-name drill-down with excerpts (R55).
11.4 Lazy-load any discussions a cross-view needs that aren't cached, then cache them.
11.5 All Comments time-range filter: a row of Day / Week / Month / Quarter / Year buttons above the unified search, combining (AND) with the tag and freetext filters; it resets to All on entering the screen and the result counter reflects the filtered set.

**Acceptance criteria**
- Each page renders aggregated data across discussions; opening them loads missing discussions on demand.
- The unified search box correctly combines a `#tag`, an `@Name`, and freetext in one query on every list page.
- All Names shows accurate counts and last-seen dates; drill-down lists the right discussions/excerpts.
- The All Comments time-range buttons (Day/Week/Month/Quarter/Year) narrow results in combination with the active search query and reset to All on re-entry.

---

## Step 12 — Kanban and Rule of Three

**Substeps**
12.1 Kanban board: drag-and-drop across state columns, persisting the state change through `setTaskState` (R22).
12.2 Done-column 2-month time limit; camera icon on cards with an image; priority sort (R45, v1.28, v2.5).
12.3 Ro3 page: randomly select 3 open tasks (one per priority), refresh, discussion-tag filter, session persistence; muted tasks are excluded from candidates and an individual task is re-picked when it is resolved, made obsolete, or muted (R47, v2.4).

**Acceptance criteria**
- Dragging a card to another column changes the task's state and persists it; the file matches the harness format.
- The Done column hides items resolved more than two months ago; cards with images show the icon.
- Ro3 shows one high/medium/low task, refreshes to a new set, and survives a reload via session persistence.

---

## Step 13 — Activity dashboard

**Substeps**
13.1 `dashboard.js` reading store selectors.
13.2 Pie charts: five time-range comment-inflow pies (Last Week, Last Month, Last Quarter, Last Year, All Time), each breaking the entries in its range down by type (comments, tasks, followups, goals); plus a task-states pie and a goal-states pie (R33).
13.3 Monthly timeline (comments, tasks, links, images) and cumulative entries area chart + open-task balance stacked bar (R37, v1.39).

**Acceptance criteria**
- All charts render from real folder data and match hand-counted totals on a small sample.
- `dashboard.js` imports only `store.js` and `ui.js` — no other page depends on it and it depends on no other page.

---

## Step 14 — AI Summary and exports

**Substeps**
14.1 AI Summary page: configurable LLM endpoint, POST a discussion history, stream the response through `safeSetHtml`; persist config + summaries in `summary.md` (R51, v2.11).
14.2 Markdown contribution summary export per discussion (R13).
14.3 Top-chrome print button routes to the active page's `print()`; hidden on kanban/Ro3/dashboard/summary (R59, v2.30).

**Acceptance criteria**
- Configuring an endpoint and running a summary renders sanitized output and writes `summary.md`; config persists across reload.
- The contribution export produces valid Markdown for the active discussion.
- The print button targets the correct handler per screen and is hidden where specified.

---

## Step 15 — Hardening and MVP parity

**Substeps**
15.1 XSS pass: confirm every `innerHTML` goes through `safeSetHtml`; image-path guard and URL-scheme allowlist in place (R58).
15.2 Slim mode (<800px) with Nav/Notes/Tasks tabs (R32); tooltips on all interactive elements (R26).
15.3 Help dialog documenting all cross-discussion pages and behaviors (R49).
15.4 Full parity sweep: walk the requirements list against chippy; run the regression harness; spot-check a copy of the real data folder.

**Acceptance criteria**
- A scripted XSS probe in entry text, prep, image path, and link href is fully neutralized.
- Slim mode renders the tabbed layout under 800px; tooltips present throughout; help lists every page.
- Every applicable requirement (R1–R59) is demonstrably present; the harness is green; a copy of the real folder opens, displays, and round-trips without data loss.

---

## Cross-cutting definition of done (every step)

1. No console errors in Chrome/Edge.
2. The regression harness passes whenever `format.js` or `io.js` was touched.
3. Any file written reopens identically (format fidelity).
4. One-way module dependencies preserved (presentation → `ui.js` → `store.js` → `io.js`/`format.js`).
5. All HTML rendered via `safeSetHtml`.
