# Chippy — Changelog

Version history of implementation changes for the chippy rewrite. This file is the single
reference for the version history; add an entry whenever a piece of implementation work lands.

The MVP-era history (v0.1–v2.42) was retired when the rewrite began and is no longer tracked here.
This log covers the from-scratch rewrite, which follows the
[implementation plan](implementation-plan.md) step by step.

## Format

One entry per change, **oldest at the top, newest at the bottom — append new entries at the end**:
`### vX.Y — YYYY-MM-DD — short title`, a one-line summary, then bullet detail. Minor (`vX.Y`) per
shipped change; major bumps for milestones. Note harness status when `format.js`/`io.js` change;
reference the requirement (`R#`) / plan step.

## Released

### v3.0.0 — 2026-06-01 — MVP parity (15-step rewrite complete)

> The from-scratch rewrite reaches feature parity with the MVP. All 15 implementation-plan steps
> are built, the regression harness is green, and the real DOMPurify sanitizer is vendored.

- Requirements **R1–R59** implemented across Steps 1–15 (R5/R15/R27/R32 were intentionally removed).
- Vanilla classic scripts on a global `Chippy` namespace; runs directly from `file://`, no build, no server.
- Data format frozen and pinned by the regression harness (**7/7** byte-for-byte).

## Build history

### v3.0.0-dev.1 — 2026-05-31 — Scaffold, format & persistence (Steps 1–3)

> App shell plus the persistence layer.

- **Step 1** — `app.html` shell (36px top chrome, theme toggle), `style.css` dark/light CSS-variable palette, module stubs, SPDX headers, `THIRD-PARTY-NOTICES`, DOMPurify placeholder.
- **Step 2** — `format.js` pure parse/serialize (discussion/navigation/tags/names/summary) + legacy migration; harness wired, **7/7** byte-for-byte.
- **Step 3** — `io.js` File System Access wrappers + split-index legacy migration + `ImageStore` behind `isSafeImagePath`; path guards **17/17**.

### v3.0.0-dev.2 — 2026-05-31 — Open Folder control

> Sidebar Open Folder button wired to the persistence layer to connect and verify a data folder.

### v3.0.0-dev.3 — 2026-05-31 — Classic scripts + Step 4 store

> Switched off ES modules to run from `file://`, and added the single source of truth.

- All scripts rewrapped as IIFEs on `window.Chippy.*` (no `import`/`export`); `app.html` loads ordered `<script>` tags; harness adapter reads `globalThis.Chippy.format`. Runs from `file://`, no server.
- **Step 4** — `store.js`: in-memory state, selectors, event emitter, `openFolder` (index only) + lazy `selectMember` (shipped on this cache version).

### v3.0.0-dev.4 — 2026-05-31 — Step 5: UI controls foundation

> The sanitize boundary and renderer.

- `NOTEBOOK_SANITIZE_CONFIG` + `safeSetHtml` (the single `innerHTML` site); `parseMd`/`renderEntryText` (markdown + inline images + `@[Name]` chips + URL links); `showToast` (R58).

### v3.0.0-dev.5 — 2026-05-31 — Step 6: Discussion screen + navigation

> The authoring screen and the sidebar.

- Sidebar grouped by tag, favorites pinned, avatars, live search + clear (R42, R43); screen router; member header (favorite, reload-from-disk); preparation markdown↔edit; auto-focus on select (R1, R52).

### v3.0.0-dev.6 — 2026-06-01 — Step 7: Entry input & write pipeline

> Authoring with the full write rules.

- `addEntry`: #tag→union, bare-URL auto-link, `@[Name]` register, goal-id minting + linking, auto-`low` priority, seconds timestamp; entry box with chip extraction, `#`/`@` autocomplete, goal-link, due, draft autosave + orphan cleanup; history reserved-tag markers (R3, R4, R31).

### v3.0.0-dev.7 — 2026-06-01 — Step 8: Task & followup management

> The seven-state machine and its controls.

- `setTaskState` (markers before actions; followup→resolvedfollowup), `cyclePriority`, `setDue`, `appendAction` (consolidated section), `toggleMute` (5-day) (R20, R23); right-panel Open Tasks with state dropdown, priority/due, ⚡ action modal, resolve; resolved/obsolete collapse in history.

### v3.0.0-dev.8 — 2026-06-01 — Step 9: Goal management

> Achieve/cancel transitions, inline edit, navigation.

- `setGoalState` (achievedgoal/canceledgoal + markers), `editEntry` with same-day `Updated:` rule; right-panel Goals list; inline entry edit; scroll-to-entry + double-click navigation (R39, R40).

### v3.0.0-dev.9 — 2026-06-01 — Fix: store↔io save signatures

> Creating a goal threw `Cannot read properties of undefined (reading 'map')`.

- `store` called `saveTags`/`saveNames`/`saveNav` without the `dirHandle` argument; the value landed in the wrong slot and `serialize*` got `undefined`. Fixed all call sites.

### v3.0.0-dev.10 — 2026-06-01 — Step 10: Images, gallery & links

> Image paste, gallery/overlay, link rename, move/delete.

- `Ctrl+V` paste → JPEG + inline ref (R13); right-panel Links (rename) + Images gallery with carousel overlay (R31, R44); move comment between discussions transferring images (R29, R40); delete removes image files.
- Audited all 23 `io()` call sites pass `dirHandle` first (closes the dev.9 bug class).

### v3.0.0-dev.11 — 2026-06-01 — Step 11: Cross-discussion pages + unified search

> Six aggregate views with one search syntax.

- All Comments / Tasks / Goals / Links / Images / Names, each with a unified `#tag` / `@name` / freetext search + clear (R30, R57); All Names counts/last-seen/drill-down (R55); lazy-load all discussions on open.

### v3.0.0-dev.12 — 2026-06-01 — DOMPurify placeholder warns once

> Fixed console flooding from the not-yet-vendored sanitizer placeholder (warns once per session).

### v3.0.0-dev.13 — 2026-06-01 — Step 12: Kanban & Rule of Three

> Drag-and-drop board and the focus picker.

- Kanban: six state columns, HTML5 drag-drop → `setTaskState`, DONE limited to ~2 months, priority sort, 📷 on image cards (R24, R45).
- Ro3: one task per priority with Refresh and session-persistent selection (R47).

### v3.0.0-dev.14 — 2026-06-01 — Step 13: Activity dashboard

> `dashboard.js` (depends only on store/ui).

- Aggregations (inflow-by-range, task/goal state counts, monthly timeline, cumulative) — Node-tested.
- Hand-rolled SVG charts via `createElementNS`: five time-range comment-inflow pies + task-state + goal-state pies + activity timeline (R33, R37).

### v3.0.0-dev.15 — 2026-06-01 — Step 14: AI Summary & exports

> Local-LLM summaries, contribution export, and the context-aware print button.

- AI Summary page: configurable endpoint + model (persisted to `summary.md` + `localStorage`), day/week/month range, Generate POSTs to an OpenAI-compatible endpoint and renders via `safeSetHtml`; saved cards with delete (R55).
- Per-discussion Markdown contribution export (R14); top-chrome print button routes per active screen, hidden on kanban/ro3/activity/summary (R59). `summary.md` round-trips byte-stable.

### v3.0.0-dev.16 — 2026-06-01 — Step 15: Hardening & MVP parity

> XSS boundary made live, plus help, slim mode, and the parity sweep.

- Real **Cure53 DOMPurify 3.2.6** vendored → `safeSetHtml`/`renderEntryText` sanitize for real; URI allowlist rejects `javascript:`/`data:`; image paths guarded by `isSafeImagePath`. `innerHTML` confined to `safeSetHtml` (audited).
- Help dialog listing every cross-discussion page + authoring behaviors (R49); slim layout under 800px (R36); tooltips throughout (R29). Harness **7/7**.

### v3.0.0-dev.17 — 2026-06-02 — Newest-first ordering across views

> Chronological lists now show the most recent item first.

- Discussion history renders newest day + newest entry first; per-discussion gallery newest first.
- All Tasks and All Goals sorted by `created_at` descending; All Images ordered by source-entry date descending.
- `getLinks` now tracks each link's newest source date and returns links newest-first; All Links sorts the aggregated set by date descending. (Node-checked.)
- All Comments and AI Summary cards were already newest-first.

### v3.0.0-dev.18 — 2026-06-02 — Unified comment box everywhere

> One fully-interactive comment card, identical in look and behaviour across every view.

- New shared `ui.entryCard(entry, opts)`: timestamp, optional member label, state square, priority square, visible tags, and the full control set — inline edit (✎), ⚡ action, mute, ✓ resolve, move (➜), delete (🗑) — with controls that don't apply to a tagless entry simply not rendering. Actions default to store mutations keyed by `(opts.member, created_at)`; `opts.on*` override them.
- Routed through it: discussion history, All Comments / All Tasks / All Goals, Ro3, and the AI Summary cards — replacing the previous bespoke renderers.
- **Summary cards are now real comment boxes**: edit rewrites the summary, delete removes it, and **move** turns a generated summary into a new entry in any discussion (`store.moveSummaryToDiscussion`, plus `updateSummary`). 
- `pages.refresh()` re-renders the active screen after a card action, so cross-views update live (not just the discussion).
- Move/delete dialogs and the entry-card styling consolidated into `ui.js`/`.entry-card`.

### v3.0.0-dev.19 — 2026-06-02 — Comment box styling: filled cards, 5px gap

> Comment boxes read as distinct sections instead of line-separated rows.

- `.entry-card` now has a `var(--surface)` background (slight contrast to the page background) with rounded corners and padding, replacing the bottom divider line.
- 5px vertical gap between cards (`margin-bottom: 5px`). The task/followup/goal left-color stripe is retained.

### v3.0.0-dev.20 — 2026-06-02 — Square corners app-wide

> Removed rounded corners everywhere for a consistent square aesthetic.

- Global `*, *::before, *::after { border-radius: 0 !important; }` flattens all elements (cards, buttons, inputs, chips, modals, avatars, chrome buttons). Overrides every per-element radius, including the dev.19 comment-card rounding.

### v3.0.0-dev.21 — 2026-06-02 — Square content boxes (controls stay rounded)

> Scoped the square aesthetic to content boxes only; entry fields, buttons, and chips keep their rounded corners as before.

- Removed the dev.20 global `*{border-radius:0!important}` rule, which had flattened everything including inputs/buttons/chips/avatars/modals.
- `border-radius: 0` now applied only to the content boxes: `.entry-card`, `.ro3-card`, `.summary-card`, `.summary-output`, `.kanban-card`, `.chart`. Inputs, buttons, chips, and other controls retain their prior rounding.

### v3.0.0-dev.22 — 2026-06-02 — Ro3: drop the double box

> Rule of Three cards were a comment box nested inside an extra `.ro3-card` wrapper.

- `ro3Card` now returns the unified `entryCard` directly — no outer wrapper — so each item is a single comment box like everywhere else.
- Removed the unused `.ro3-card` / `.ro3-card .btn-sm` styles; tightened `.ro3-cards` gap to 8px.

### v3.0.0-dev.23 — 2026-06-02 — Collapse only finished items

> Comment boxes no longer collapse just because they span multiple lines.

- A card starts collapsed only when the item is finished: a done/obsolete task (or done followup) or an achieved/canceled goal — previously achieved/canceled goals were not treated as closed.
- Removed the multi-line auto-collapse: all other comments now render in their entirety, with no expand triangle.
- The expand triangle is shown only on finished items so they can still be opened.

### v3.0.0-dev.24 — 2026-06-02 — Ro3 cards use full width

> Rule of Three cards were capped at 640px; the other list views aren't.

- Removed the `max-width: 640px` on `.ro3-cards` so cards span the full content width, matching All Comments / All Tasks.

### v3.0.0-dev.25 — 2026-06-02 — Restore paragraph spacing in comments

> Blank lines between paragraphs were collapsing, so multi-paragraph comments read as one run-on block.

- The global `* { margin: 0 }` reset had zeroed `<p>`/heading/list/blockquote margins inside rendered entry text. Added `.entry-text` block spacing (`0 0 .7em`, last child flush) so a blank line between paragraphs now renders as a visible pause.

### v3.0.0-dev.26 — 2026-06-02 — Fix inline images in comments

> Inline images showed a broken-image icon in discussions and the cross-views.

- Rendered entry text produces `<img data-src="…">` with no real `src`; the unified `entryCard` never resolved those (only the gallery did). It now resolves each `data-src` to a blob URL via `store.getImageUrl`.
- Clicking an inline image opens the full-screen carousel over all images in that card.

### v3.0.0-dev.27 — 2026-06-02 — Clear the entry box after saving

> After saving, the text and tag chips lingered in the input.

- The clear ran after `await addEntry`, but `addEntry` emits `entryAdded` mid-await, which re-renders the discussion and rebuilds the entry box from the still-present draft — so the new box restored the old content.
- Now the textarea, tag chips, due date, goal link, and the saved draft are all cleared *before* the await, so the rebuilt box comes up empty.

### v3.0.0-dev.28 — 2026-06-02 — Independent scroll for discussion columns

> The discussion page scrolled as one block; the right panels drifted off with the history.

- `#memberScreen` is now a flex column: the member header stays fixed, and the middle (comments) and right (tasks/goals/links/gallery) columns each get their own scrollbar, shown only when that column overflows.
- Slim mode (<800px) stacks the columns, so it reverts to a single page-level scrollbar.

### v3.0.0-dev.29 — 2026-06-02 — Entry box: chips and controls below the textarea

> Reorganized the comment entry box layout.

- Tag chips moved from above the textarea to below it, left-aligned.
- Goal-link dropdown, due-date picker, and Save button now sit on the same row, pushed to the right.
- New `.entry-footer` flex row holds chips (left) and controls (right).

### v3.0.0-dev.30 — 2026-06-02 — Comment counts in title and sidebar

> Show how many comments each discussion has.

- Discussion page: the comment count appears next to the title (e.g. "42 comments"); the header actions move to the far right.
- Sidebar: each discussion shows its comment count just left of the name. All discussions are loaded in the background on folder open so counts are available; counts refresh live on add/delete/move.

### v3.0.0-dev.31 — 2026-06-02 — Thinner scrollbars

> Slimmed the scrollbars app-wide.

- 6px WebKit scrollbars with a transparent track and a `--border` thumb (hover `--muted`); Firefox `scrollbar-width: thin` with a matching color.

### v3.0.0-dev.32 — 2026-06-02 — Sidebar comment count as a right-aligned chip

> Moved the sidebar count from left of the name into a small pill on the far right.

- `.member-count-badge` is now a rounded chip (pill) pushed to the right edge of each discussion row, matching the requested style.

### v3.0.0-dev.33 — 2026-06-02 — Discussion columns reach the top chrome

> Removed the full-width header band and top padding so both columns start at the top.

- The member header (title, count, actions) moved into the top of the middle column; the previous full-width band above the columns is gone.
- Dropped the discussion screen's top padding and the split-view top margin, so the middle and right sections run all the way up to the top chrome.
- The in-column header is sticky, so the title/actions stay visible while the comments scroll.

### v3.0.0-dev.34 — 2026-06-02 — Even spacing between discussion columns

> The middle→right gap looked wider than the left inset because the middle column's scrollbar sat inside it.

- Reserved a stable scrollbar gutter on both discussion columns (`scrollbar-gutter: stable`) and set the inter-column gap to 10px, so the comment content sits ~16px from the right panel — matching the 16px left inset.

### v3.0.0-dev.35 — 2026-06-02 — Discussion comments show time only

> The full date on each comment duplicated the day-group label above it.

- `entryCard` gained a `timeOnly` option; the discussion history passes it, so each comment shows just the time (e.g. "01:42:17"). Cross-views keep the full timestamp since they aren't day-grouped.

### v3.0.0-dev.36 — 2026-06-02 — "Today" label in discussion history

> The current day's group label now reads "Today" instead of the date.

- In the discussion history, the day-group label compares against `store.nowISO()` and renders "Today" when the group is the current date; other days still show the ISO date.

### v3.0.0-dev.37 — 2026-06-02 — Archive a discussion

> Re-introduced the archive feature end to end.

- New `store.archiveDiscussion(name)`: calls `io.archiveDiscussion` (renames the file to `*.archive.md`), drops the discussion from the navigation index, forgets any cached copy, clears the active selection if needed, and persists the nav. Archived files are skipped by `listDiscussions` so they're no longer loaded.
- Discussion header gains a 🗄 archive button with a confirm dialog (nothing is deleted — the file is renamed and can be restored). On archive, the sidebar re-renders and the app returns to the welcome screen.

### v3.0.0-dev.38 — 2026-06-02 — Fix flaky kanban drag-and-drop

> Dropping a card sometimes moved the wrong task or did nothing.

- The drop handler relied on `dataTransfer.getData('application/json')`, which is unreliable on `file://` and returns empty when the drag starts on a child node (e.g. an image), causing silent no-ops and mismatched drops.
- Now the dragged card is tracked in a module-level reference (set on `dragstart`, cleared on `dragend`/`drop`), with a `text/plain` payload as fallback. Inner card images are marked non-draggable, and `effectAllowed`/`dropEffect` are set to `move`.

### v3.0.0-dev.39 — 2026-06-02 — All Tags page

> New cross-discussion page listing every tag with usage stats.

- `store.getAllTags()` aggregates user-facing tags across all loaded discussions (reserved/state/priority/goal-id/muted excluded), with total count and most-recent use, sorted by last-used.
- New "Tags" sidebar page (`allTags`) with the shared search bar: each row shows the tag chip, its total use count, and the date it was last used. Added to the print-enabled screens.

### v3.0.0-dev.40 — 2026-06-02 — Fix kanban dropping the wrong task (identity collision)

> Dropping still occasionally moved a different task than the one dragged.

- Root cause: entries are identified by `created_at`, and `findEntry` matched the *first* entry with that timestamp — so two entries in one discussion sharing a timestamp (minute-precision or rapid entries) collided, moving the wrong one.
- `collectEntries` now tags each entry with its array index `_idx`; `findEntry`/`setTaskState` accept an optional index hint (trusted only if that slot still has the same `created_at`, else falls back to the timestamp search). The kanban drag carries the index so the exact dragged entry is mutated.

### v3.0.0-dev.41 — 2026-06-02 — Task burndown chart on Activity

> New chart on the Activity page tracking remaining open tasks over time.

- `dashboard.taskBurndown` computes, for each month from the first activity to now, the number of still-open task/followup entries (created up to that month minus those closed via a `Resolved:`/`Obsolete:` marker up to that month).
- Rendered as a wide filled area+line chart ("Open tasks over time (burndown)") below the activity timeline. Aggregation helpers (`taskBurndown`, `closedMonthOf`, `monthsBetween`) exposed for tests.

### v3.0.0-dev.42 — 2026-06-02 — Edit tags while editing a comment

> Inline comment edit now manages tags, not just body text.

- The edit view shows the comment's visible #tags as chips (each with × to delete) plus a "+ tag" input (Enter/comma/space adds, Backspace on empty removes the last). Reserved tags (task/state/priority/goal-id/muted) are preserved untouched.
- Save writes `{ text, tags }` via `store.editEntry`. Blur only saves when focus leaves the whole edit box, so moving between the textarea and the tag editor no longer commits prematurely; the Summary edit path stays body-only.

### v3.0.0-dev.43 — 2026-06-02 — Exclude images from the Links list

> Image references showed up as entries in the Links panel and All Links.

- `extractLinks` skips a `[label](url)` match when it's preceded by `!` (i.e. an `![alt](src)` image reference), so only real links appear in the right-panel Links section and the All Links page.

### v3.0.0-dev.44 — 2026-06-03 — Fix adding tags while editing a comment

> Adding a tag during edit didn't work and "#tag" typed in the body wasn't recognized.

- Root cause: `renderTags` rebuilt the whole row including the focused add-input; removing the focused input fired a `blur` that prematurely saved and exited edit. The add-input now stays mounted and only the chips re-render.
- Typing `#tag ` in the edit textarea now extracts it into a chip immediately (matching the new-comment box). Enter/comma/space in the add-input still add a tag; Backspace on an empty input removes the last.

### v3.0.0-dev.45 — 2026-06-03 — Task execution chart on Activity

> New per-day stacked bar chart of tasks created, colored by current state.

- `dashboard.taskExecution` groups task/followup entries by their creation day and counts each day's tasks by current state (OPEN/WIP/CHK/HOLD/PRGT/DONE/OBSL).
- Rendered as a wide stacked bar chart ("Tasks created per day (by current state)") with per-segment hover tooltips, per-bar totals, rotated date labels, and a state legend — below the burndown chart.

### v3.0.0-dev.46 — 2026-06-03 — Tighter spacing between right-panel sections

> The Tasks/Goals/Links/Images sections in the discussion right panel were 18px apart.

- Reduced the bottom margin of `.tasks-section`/`.goals-section`/`.links-section`/`.gallery-section` to 5px, matching the comment-box spacing, so Tasks and Goals (and the rest) sit closer together.

### Docs — 2026-06-03 — UI element overview diagram

> Documentation only — no app code or cache-bust change.

- Added `documentation/chippy-ui-overview.svg`: an annotated diagram of the discussion (main) screen with all 31 elements numbered on a mockup and named in an index, each labelled with its CSS class/selector (top chrome, sidebar, middle column, comment box, right panel).

### v3.0.0-dev.47 — 2026-06-04 — Slim-mode region tabs (<800px)

> On narrow screens the sidebar, comments, and right panel competed for space; now three tabs switch between them.

- Added a tab bar under the top chrome, shown only in slim mode (`.slim-tabs`): **Navigation** (sidebar), **Discussion** (middle column), **Tasks & Goals** (right column). Body classes `slim-nav`/`slim-mid`/`slim-right` reveal exactly one region.
- `main.setSlimTab` (exposed as `Chippy.setSlimTab`) drives the tabs; defaults to Discussion. Selecting a discussion or opening a cross-view in slim mode auto-switches to the Discussion tab so the chosen content is visible.
- Wide screens are unaffected — the tab bar is hidden and the two-column layout is unchanged.

### v3.0.0-dev.48 — 2026-06-04 — Reliable 5px gap between right-panel sections

> The dev.46 per-section `margin-bottom` didn't reliably render a visible gap between Tasks and Goals.

- The right column (`.split-right`) is now a flex column with `gap: 5px`, and the per-section bottom margins (`.tasks-section`/`.goals-section`/`.links-section`/`.gallery-section`) are zeroed — guaranteeing an exact, consistent 5px separation between Tasks, Goals, Links, and Images.

### v3.0.0-dev.49 — 2026-06-04 — 5px gap between right-panel task/goal items

> dev.46/48 spaced the right-panel *sections*, but the task (and goal) *items within* a section still ran together as one continuous stripe.

- `.task-item` / `.goal-item` now use a filled `var(--surface)` background with `margin-bottom: 5px` and no bottom divider — matching the comment-box look — so each task and each goal sits in its own card 5px from the next.

### v3.0.0-dev.50 — 2026-06-04 — Right-panel task row: controls on the bottom

> Reorganized the Open Tasks rows so the text gets the full width and all controls live on one bottom row.

- Priority and state squares moved from beside the text into the bottom control row (`task-meta`), leaving the task text full-width up top (`task-top`). The bottom row now wraps.
- Empty due date shows only the native calendar icon instead of the full `tt.mm.jjjj` field (`.task-due.collapsed`); a set date still shows the full field.
- Removed the redundant resolve (✓) button from both the task row and the unified comment box — the state square already sets DONE.

### v3.0.0-dev.51 — 2026-06-04 — Background box behind the right-panel Links

> The Links list now sits in its own filled box, like the task cards.

- Link rows are wrapped in a `.link-list` container with the task `var(--surface)` background and padding, giving the right-column Links section the same filled-box look as the tasks.

### v3.0.0-dev.52 — 2026-06-04 — Task row: chips left, functions right

> Split the task control row so priority/state sit on the left and everything else on the right.

- Added a flex spacer (`.meta-spacer`) after the priority and state squares in `task-meta`, pushing age, due date, action (⚡), and mute (🔇) to the right edge of the row.

### v3.0.0-dev.53 — 2026-06-04 — Goal row: buttons bottom-right

> Right-column goal controls now align to the bottom right.

- `.goal-meta` uses `justify-content: flex-end`, so the goal action (⚡), edit (✎), achieved (✓), and canceled (✕) buttons sit at the bottom-right under the goal text.

### v3.0.0-dev.54 — 2026-06-04 — Task execution chart: show every day

> The chart skipped days with no tasks; now the x-axis is continuous.

- `dashboard.taskExecution` fills every calendar day between the first and last activity (`daysBetween`), so days with no tasks created appear as empty gaps rather than being collapsed out.
- To keep the axis readable, x-axis date labels are thinned (~12 max) and the per-bar total label is hidden on empty days.

### v3.0.0-dev.55 — 2026-06-04 — Fix task state change: wrong entry & scroll jump

> Changing a task/followup state could hit a different task, and the view jumped to the top.

- **Wrong entry:** state changes from the discussion history, cross-views, and the right-panel Open Tasks now pass the entry index hint to `setTaskState` (like the kanban fix in dev.40), so when two entries share a `created_at` the exact selected one is changed — not the first match.
- **Scroll jump:** `discussion.render` now preserves each column's scroll position across the re-render and focuses the entry box with `preventScroll`, instead of auto-scrolling to the top. A fresh discussion open still starts at the top (`render(member, { fresh: true })`).

### v3.0.0-dev.56 — 2026-06-04 — In-place card update keeps the view perfectly still

> dev.55 reduced the jump but a full re-render still reflowed images, so it wasn't exact.

- Single-entry mutations (state, priority, due, action, mute, goal state, edit) now update **only that entry's card in place** via `discussion.refreshEntry(entryId)` rather than re-rendering the whole discussion. Nothing above the card reflows, so its top stays exactly put; if the change collapses the card, only the content below it shifts. A pure state change leaves everything exactly in place.
- The right panel is refreshed in place with its scroll preserved. Adds/deletes/moves and cross-views still do a full refresh.

### v3.0.0-dev.58 — 2026-06-04 — Edit/priority/mute/goal changes hit the right entry

> Adding a tag to a comment (or editing it) could land on a different entry that shared its timestamp, so the edited comment never showed the change.

- Extended the dev.40/55 index-hint fix to the remaining entry mutations: `editEntry`, `cyclePriority`, `setDue`, `appendAction`, `toggleMute`, and `setGoalState` now accept the entry's index and pass it to `findEntry`, so the exact selected entry is changed even when two share a `created_at`.
- All call sites updated to pass the index: the comment card (`entryCard`), the right-panel task rows, and the goal rows.

### v3.0.0-dev.59 — 2026-06-04 — "Preparation" → "Description", title hides when filled

> Renamed the per-discussion preparation area and let it shed its label once used.

- The preparation section is now labelled **Description** (empty state: "No description yet.", tooltip "Edit description").
- The "Description" title is hidden as soon as the field has text — the content speaks for itself — and reappears when the field is empty. The ✎ edit affordance stays.

### v3.0.0-dev.60 — 2026-06-04 — Description edit pencil to the top-right

> Moved the description ✎ to the right edge of the middle column.

- `.prep-edit-btn` is now absolutely positioned at the top-right of the description section (`.prep-section` is the positioning context), level with the top of the description text. The description content gets a little right padding so the pencil never overlaps it.

### v3.0.0-dev.61 — 2026-06-04 — Nudge the description edit pencil

> Fine-tuned the pencil position.

- `.prep-edit-btn` moved 4px down and 3px left (`top: 4px; right: 3px`).

### v3.0.0-dev.62 — 2026-06-04 — Align entry-box controls to one height

> The goal link, due date, and Save button were slightly different heights.

- The goal-link dropdown, due-date selector, and Save button in the comment entry box now share a fixed 30px height (scoped to `.entry-controls`, with `box-sizing: border-box`), so they line up evenly. Other primary buttons are unaffected.

### v3.0.0-dev.63 — 2026-06-04 — Slimmer entry-box controls (22px)

> Reduced the shared control height.

- Entry-box controls (goal link, due date, Save) reduced from 30px to 22px, with vertical padding zeroed so the text still fits.

### v3.0.0-dev.57 — 2026-06-04 — Goals stand out with a goal-tinted background

> Goals are the reason for many discussions, so they should catch the eye.

- New `--goal-bg` theme variable — the surface colour with a hint of the goal teal (`#203043` dark, `#e6ecf2` light). Applied to goal comment cards (`.entry-card.entry-goal`) and right-panel goal items (`.goal-item`), so goals read as distinct from tasks/comments in both themes while keeping the goal left stripe.
