# Chippy — Target Architecture

## Context and goals

Chippy is a clean re-implementation of the Personal Notebook app. The existing MVP
(`notebook/local/`) works but is a monolith: `app.js` is ~4,900 lines holding global state, every
screen's render logic, all UI wiring, and all print handlers in one file, with a single global
`members` array as the de-facto store. The data format itself is sound and is frozen by the
[data definition](datadefinition.md) and guarded by the
[regression harness](../regressionharness/README.md).

The goal of the rewrite is **the same product, a maintainable structure**: preserve the data
format and feature set (see the requirements list in `notebook/documentation.md`), but split the
code into modules with clear responsibilities, a single source of truth, and one-way dependencies
so each layer can be tested and changed in isolation.

Non-goals: no framework, no build step, no server, no new features beyond what the MVP already
has. Technology stays vanilla HTML/CSS/JS ES modules plus DOMPurify, opened directly in
Chrome/Edge against a local folder via the File System Access API. Stability over novelty.

## Module overview

The code is a set of **flat script files at the app root — no module subfolders.** The scripts
form three logical layers; dependencies point downward only, nothing in a lower layer imports
from a higher one.

```
                     ┌────────────────────────────────────────┐
 Presentation layer  │  discussion.js   pages.js   dashboard.js │
 (screens)           └────────────────────────────────────────┘
                                │            │            │
                                ▼            ▼            ▼
                     ┌────────────────────────────────────────┐
 Shared UI layer     │            ui.js  (controls)            │
                     └────────────────────────────────────────┘
                                        │
                                        ▼
                     ┌────────────────────────────────────────┐
 Core layer          │        store.js  (single source)        │
                     └────────────────────────────────────────┘
                                        │
                                        ▼
                     ┌────────────────────────────────────────┐
 Persistence layer   │  io.js      (File System Access)        │
                     │  format.js  (pure parse/serialize)      │
                     └────────────────────────────────────────┘
```

All scripts sit flat next to `app.html` and `style.css`: `main.js`, `format.js`, `io.js`,
`store.js`, `ui.js`, `discussion.js`, `pages.js`, `dashboard.js`. `main.js` bootstraps the app
and owns the screen router. There are no subdirectories for the application code.

`store.js` is the hub: every screen reads from it and subscribes to its change events; every
mutation goes through it; it is the only caller of `io.js`. The presentation scripts never touch
disk and never talk to each other — they coordinate only through the store.

| Script | Layer | Responsibility | Depends on |
|---|---|---|---|
| `format.js` | persistence | Pure parse/serialize for every Markdown file type + legacy migration; no I/O, runs in Node | (nothing — leaf) |
| `io.js` | persistence | File System Access wrappers (open/list/load/save/rename/archive) and the image store, built on `format.js` | `format.js` |
| `store.js` | core | Hold the in-memory source-of-truth object; selectors + mutation actions; persist through `io.js`; emit change events | `io.js` |
| `ui.js` | shared UI | Reusable, data-agnostic controls (chips, dropdowns, modals, markdown renderer, sanitize, toast) | `store.js` (read/dispatch only) |
| `discussion.js` | presentation | The per-discussion authoring screen (prep, entry input, history, right panel) | `ui.js`, `store.js` |
| `pages.js` | presentation | The cross-discussion views and the screen router | `ui.js`, `store.js`, `dashboard.js` |
| `dashboard.js` | presentation | The Activity view (charts), kept standalone | `ui.js`, `store.js` |

## Module responsibilities and interfaces

### `format.js` and `io.js` — persistence

Two flat scripts split the persistence layer into pure transforms (`format.js`) and disk I/O
(`io.js`).

`format.js` — pure parse/serialize, no I/O, importable in Node. This is the part the regression
harness wires to. Function groups:

- discussion parse/serialize — `parse(md, filename) → member`, `serialize(member) → md`. Frozen
  behavior; exactly what the harness pins.
- navigation parse/serialize — `navigation.md` (discussions + theme).
- tags / names parse/serialize — the split `tags.md` and `names.md`.
- summary parse/serialize — `summary.md` (config + summaries).
- legacy migration — on load, if `tags.md` / `names.md` are absent, read the inline `## Tags` /
  `## Names` sections from `navigation.md`, then migrate to the split files (datadefinition.md §3.4).

`io.js` — File System Access wrappers built on `format.js`: open folder, list/load/save/rename/
archive discussions, read/write the index files, and the image store (`saveImage`, `moveImage`,
`deleteImage`, `getImageUrl`) behind the `isSafeImagePath` guard.

Rule: `format.js` imports nothing from `io.js`, so the pure transforms run in Node for the harness.

### `store.js` — single source of truth

One script owning the entire in-memory application state and the only path to mutate it.

State shape (the source-of-truth object):

```
{
  folderReady,                       // is a folder open
  nav: { discussions[], theme },     // from navigation.md
  tags: [],                          // from tags.md (the union)
  names: [],                         // from names.md
  members: Map<name, member|null>,   // lazy: null until loaded
  activeMemberName,                  // current discussion
  activeScreen,                      // router state
  ui: { filters, search, draft },    // transient view state
}
```

- **Selectors (read):** `getDiscussions()`, `getActiveMember()`, `getOpenTasks(memberOrAll)`,
  `getGoals(...)`, `getTagUnion()`, `getNames()`, etc. Pure reads over the state.
- **Actions (mutate):** `openFolder()`, `selectMember(name)` (lazy-loads via `io.js`),
  `addEntry(...)`, `editEntry(...)`, `setTaskState(entry, state)`, `setPriority(...)`,
  `linkGoal(...)`, `moveEntry(...)`, `archiveDiscussion(...)`, `setTheme(...)`, `registerName(...)`.
  Each action updates the in-memory state, persists the affected file(s) through `io.js`, then emits.
- **Events:** a tiny emitter (`subscribe(fn)` / `emit(changeSet)`). The store does no rendering;
  presentation scripts subscribe and re-render the parts that changed.

This replaces the MVP's global `members` array and scattered mutations. All write rules (auto-add
`low` priority, mint `goal-<id>`, append lifecycle markers, `@word`→tag, URL auto-link, `@[Name]`
handling) live here as actions, so they are defined once and unit-testable.

### `ui.js` — reusable controls

Presentation-only widgets that take data and callbacks and emit DOM. No knowledge of which screen
hosts them; they may read selectors and dispatch store actions but hold no app state of their own.

Components: markdown renderer (`renderEntryText` routed through the shared `safeSetHtml` /
DOMPurify boundary), tag-chip input, `#`/`@` autocomplete dropdowns, task **state dropdown**,
**priority dot**, **due-date picker**, **action modal** (⚡), **toast**, image paste handler,
image overlay/gallery, age indicator. One sanitize utility wraps every `innerHTML` write.

### `discussion.js` — the authoring screen

Composes `ui.js` controls against the active member from the store: the preparation area (rendered
markdown ↔ edit), the entry input with chips/goal-link/due picker, the day-grouped history, and
the right panel (open tasks, goals, links, tag recency, gallery). Subscribes to the store and
re-renders on change. This is the default screen and the speed-critical path (auto-focus on
select, draft autosave).

### `pages.js` — cross-discussion views + router

The screen router (`showScreen(name)`) plus the cross-discussion views: Tags, Comments, Tasks,
Kanban, Goals, Images, Links, Names, Ro3, Activity (delegates to `dashboard.js`), AI Summary. Each
view exposes `render(container)` and reads the store; the unified search box (`#tag`, `@Name`,
freetext) is a shared `ui.js` control reused across views. Print handlers live with their view and
the top-chrome print button routes to the active view's `print()`.

### `dashboard.js` — Activity view

Kept standalone (the MVP already extracted `dashboard.js`, requirement 42). Consumes store
selectors and renders the five time-range comment-inflow pies (Last Week / Month / Quarter / Year /
All Time, each broken down by entry type), the task-state and goal-state pies, plus the cumulative
and monthly timelines. Charts are hand-rolled SVG — no external charting dependency. Isolated so
the heavier rendering never leaks into the core or other screens.

## Data flow

**Load:** `openFolder()` → `io.js` lists files; `format.js` (navigation + legacy migration)
populates `nav`/`tags`/`names` (migrating a legacy single-file `navigation.md` if needed).
Discussions are **not** all read — only the index is. Store emits; sidebar renders.

**Open a discussion:** `selectMember(name)` lazy-loads that one file via `io.js` (parsed by
`format.js`), caches it in `members`, sets `activeMemberName`, emits; `discussion.js` renders.

**Author / mutate:** a `ui.js` control invokes a store action → the action applies the write rules,
updates in-memory state, persists the one affected file (and `tags.md`/`names.md`/`navigation.md`
only when their content actually changed), then emits a change set → subscribed screens re-render.

**Why indexes are persisted, not derived:** because discussions load lazily, the app never holds
every discussion at once, so the tag union and name list cannot be rebuilt at startup without
defeating lazy loading. `tags.md` and `names.md` are therefore authoritative files maintained
incrementally — application speed is the priority (see datadefinition.md §3).

## Key decisions and trade-offs

1. **Single store with an event emitter, not scattered globals.** Centralizes the write rules and
   makes state transitions testable. Trade-off: we hand-roll minimal reactivity instead of using a
   framework — acceptable given the small surface and the no-build constraint.

2. **Vanilla ES modules, flat files, no framework, no build step.** Matches the MVP's "stability
   over novelty" mandate and keeps the app a set of scripts opened directly in the browser.
   Trade-off: no JSX/TSX ergonomics and manual DOM updates; mitigated by the thin `ui.js` layer.

3. **Pure format transforms (`format.js`) separated from disk I/O (`io.js`).** Lets the regression
   harness run the parser/serializer in Node and pins fidelity. Trade-off: two scripts instead of
   one for persistence — worth it for the safety net.

4. **One-way dependencies (presentation → `ui.js` → `store.js` → `io.js`/`format.js`).** No screen
   imports another; all coordination is via the store. Trade-off: some indirection for cross-screen
   effects, paid back in isolation and testability.

5. **DOMPurify at a single `safeSetHtml` boundary.** Every `innerHTML` write goes through one
   sanitize helper (requirement 62). Trade-off: contributors must use the helper, never raw
   `innerHTML`; enforced by convention and review.

6. **Split index files with load-time legacy migration.** `navigation.md` / `tags.md` / `names.md`
   reduce write churn and conflict surface; existing single-file folders migrate transparently on
   first load. Trade-off: three reads at startup instead of one (negligible) and a one-time
   migration path to carry.

## Integration points

- **File System Access API** — the only persistence mechanism (`io.js`); requires a Chromium
  browser and an explicit folder grant.
- **DOMPurify** — vendored; the HTML-render boundary in `ui.js`.
- **LLM endpoint (optional)** — the AI Summary view POSTs to a user-configured local endpoint;
  config persists in `summary.md`.
- **Charts** — hand-rolled SVG inside `dashboard.js`; no external charting library.

## Mapping from the current MVP

| Current (`notebook/local/`) | Target script |
|---|---|
| `md-io.js` — MdIO, NavStore, SummaryStore (parse/serialize) | `format.js` |
| `md-io.js` — FileStore, ImageStore (File System Access) | `io.js` |
| global `members` array + scattered mutations in `app.js` | `store.js` |
| `wire*`, `renderEntryText`, `show*Dropdown`, `showActionModal`, `showToast`, image overlay in `app.js` | `ui.js` |
| `renderPrepView`, `renderHistory*`, `renderTasks`, `renderGoals`, `renderLinks`, `renderRecency`, `renderGallery`, member header | `discussion.js` |
| `showScreen`, `renderAll*`, `renderKanban*`, `renderRo3*`, `renderSummary`, `print*` | `pages.js` |
| `dashboard.js` | `dashboard.js` |
