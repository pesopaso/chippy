# Chippy — Changelog

Version history of implementation changes for the chippy rewrite. This file is the single
reference for the version history; add an entry whenever a piece of implementation work lands.

The MVP-era history (v0.1–v2.42) was retired when the rewrite began and is no longer tracked here.
This log covers the from-scratch rewrite, which follows the
[implementation plan](implementation-plan.md) step by step.

## Format

One entry per change, newest at the top: `### vX.Y — YYYY-MM-DD — short title`, a one-line
summary, then bullet detail. Minor (`vX.Y`) per shipped change; major bumps for milestones. Note
harness status when `format.js`/`io.js` change; reference the requirement (`R#`) / plan step.

## Released

### v3.0.0 — 2026-06-01 — MVP parity (15-step rewrite complete)

> The from-scratch rewrite reaches feature parity with the MVP. All 15 implementation-plan steps
> are built, the regression harness is green, and the real DOMPurify sanitizer is vendored.

- Requirements **R1–R59** implemented across Steps 1–15 (R5/R15/R27/R32 were intentionally removed).
- Vanilla classic scripts on a global `Chippy` namespace; runs directly from `file://`, no build, no server.
- Data format frozen and pinned by the regression harness (**7/7** byte-for-byte).

## Build history

### v3.0.0-dev.16 — 2026-06-01 — Step 15: Hardening & MVP parity

> XSS boundary made live, plus help, slim mode, and the parity sweep.

- Real **Cure53 DOMPurify 3.2.6** vendored → `safeSetHtml`/`renderEntryText` sanitize for real; URI allowlist rejects `javascript:`/`data:`; image paths guarded by `isSafeImagePath`. `innerHTML` confined to `safeSetHtml` (audited).
- Help dialog listing every cross-discussion page + authoring behaviors (R49); slim layout under 800px (R36); tooltips throughout (R29). Harness **7/7**.

### v3.0.0-dev.15 — 2026-06-01 — Step 14: AI Summary & exports

> Local-LLM summaries, contribution export, and the context-aware print button.

- AI Summary page: configurable endpoint + model (persisted to `summary.md` + `localStorage`), day/week/month range, Generate POSTs to an OpenAI-compatible endpoint and renders via `safeSetHtml`; saved cards with delete (R55).
- Per-discussion Markdown contribution export (R14); top-chrome print button routes per active screen, hidden on kanban/ro3/activity/summary (R59). `summary.md` round-trips byte-stable.

### v3.0.0-dev.14 — 2026-06-01 — Step 13: Activity dashboard

> `dashboard.js` (depends only on store/ui).

- Aggregations (inflow-by-range, task/goal state counts, monthly timeline, cumulative) — Node-tested.
- Hand-rolled SVG charts via `createElementNS`: five time-range comment-inflow pies + task-state + goal-state pies + activity timeline (R33, R37).

### v3.0.0-dev.13 — 2026-06-01 — Step 12: Kanban & Rule of Three

> Drag-and-drop board and the focus picker.

- Kanban: six state columns, HTML5 drag-drop → `setTaskState`, DONE limited to ~2 months, priority sort, 📷 on image cards (R24, R45).
- Ro3: one task per priority with Refresh and session-persistent selection (R47).

### v3.0.0-dev.12 — 2026-06-01 — DOMPurify placeholder warns once

> Fixed console flooding from the not-yet-vendored sanitizer placeholder (warns once per session).

### v3.0.0-dev.11 — 2026-06-01 — Step 11: Cross-discussion pages + unified search

> Six aggregate views with one search syntax.

- All Comments / Tasks / Goals / Links / Images / Names, each with a unified `#tag` / `@name` / freetext search + clear (R30, R57); All Names counts/last-seen/drill-down (R55); lazy-load all discussions on open.

### v3.0.0-dev.10 — 2026-06-01 — Step 10: Images, gallery & links

> Image paste, gallery/overlay, link rename, move/delete.

- `Ctrl+V` paste → JPEG + inline ref (R13); right-panel Links (rename) + Images gallery with carousel overlay (R31, R44); move comment between discussions transferring images (R29, R40); delete removes image files.
- Audited all 23 `io()` call sites pass `dirHandle` first (closes the dev.9 bug class).

### v3.0.0-dev.9 — 2026-06-01 — Fix: store↔io save signatures

> Creating a goal threw `Cannot read properties of undefined (reading 'map')`.

- `store` called `saveTags`/`saveNames`/`saveNav` without the `dirHandle` argument; the value landed in the wrong slot and `serialize*` got `undefined`. Fixed all call sites.

### v3.0.0-dev.8 — 2026-06-01 — Step 9: Goal management

> Achieve/cancel transitions, inline edit, navigation.

- `setGoalState` (achievedgoal/canceledgoal + markers), `editEntry` with same-day `Updated:` rule; right-panel Goals list; inline entry edit; scroll-to-entry + double-click navigation (R39, R40).

### v3.0.0-dev.7 — 2026-06-01 — Step 8: Task & followup management

> The seven-state machine and its controls.

- `setTaskState` (markers before actions; followup→resolvedfollowup), `cyclePriority`, `setDue`, `appendAction` (consolidated section), `toggleMute` (5-day) (R20, R23); right-panel Open Tasks with state dropdown, priority/due, ⚡ action modal, resolve; resolved/obsolete collapse in history.

### v3.0.0-dev.6 — 2026-06-01 — Step 7: Entry input & write pipeline

> Authoring with the full write rules.

- `addEntry`: #tag→union, bare-URL auto-link, `@[Name]` register, goal-id minting + linking, auto-`low` priority, seconds timestamp; entry box with chip extraction, `#`/`@` autocomplete, goal-link, due, draft autosave + orphan cleanup; history reserved-tag markers (R3, R4, R31).

### v3.0.0-dev.5 — 2026-05-31 — Step 6: Discussion screen + navigation

> The authoring screen and the sidebar.

- Sidebar grouped by tag, favorites pinned, avatars, live search + clear (R42, R43); screen router; member header (favorite, reload-from-disk); preparation markdown↔edit; auto-focus on select (R1, R52).

### v3.0.0-dev.4 — 2026-05-31 — Step 5: UI controls foundation

> The sanitize boundary and renderer.

- `NOTEBOOK_SANITIZE_CONFIG` + `safeSetHtml` (the single `innerHTML` site); `parseMd`/`renderEntryText` (markdown + inline images + `@[Name]` chips + URL links); `showToast` (R58).

### v3.0.0-dev.3 — 2026-05-31 — Classic scripts + Step 4 store

> Switched off ES modules to run from `file://`, and added the single source of truth.

- All scripts rewrapped as IIFEs on `window.Chippy.*` (no `import`/`export`); `app.html` loads ordered `<script>` tags; harness adapter reads `globalThis.Chippy.format`. Runs from `file://`, no server.
- **Step 4** — `store.js`: in-memory state, selectors, event emitter, `openFolder` (index only) + lazy `selectMember` (shipped on this cache version).

### v3.0.0-dev.2 — 2026-05-31 — Open Folder control

> Sidebar Open Folder button wired to the persistence layer to connect and verify a data folder.

### v3.0.0-dev.1 — 2026-05-31 — Scaffold, format & persistence (Steps 1–3)

> App shell plus the persistence layer.

- **Step 1** — `app.html` shell (36px top chrome, theme toggle), `style.css` dark/light CSS-variable palette, module stubs, SPDX headers, `THIRD-PARTY-NOTICES`, DOMPurify placeholder.
- **Step 2** — `format.js` pure parse/serialize (discussion/navigation/tags/names/summary) + legacy migration; harness wired, **7/7** byte-for-byte.
- **Step 3** — `io.js` File System Access wrappers + split-index legacy migration + `ImageStore` behind `isSafeImagePath`; path guards **17/17**.
