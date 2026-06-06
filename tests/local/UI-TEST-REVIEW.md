# UI (operate) test review — expected behaviours & gaps

All Phase 3 (operate) tests, grouped by UI surface, with the behaviour each asserts.
Assertions read the discussion `.md` back from OPFS unless noted as a UI assertion.
Source: `tests/local/e2e/operate/`. Total: **33 tests**.

Legend: 🟢 normal · 🟠 TEST-FIRST (expected to fail until the app implements it) · 🔵 VERIFY (selectors unconfirmed)

---

## Discussion view — right column, task row  (`task-goal-changes.spec.mjs`)

| # | Test | Expected behaviour |
|---|------|--------------------|
| 1 | change state: OPEN → WIP | Clicking the state square → WIP adds `inprogresstask` to the entry. |
| 2 | change priority (high → medium) | Clicking the priority square cycles the priority; entry gains `medium`. |
| 3 | add an activity | ⚡ → modal → submit writes a `Task Resolution Actions` section with the dated bullet. |
| 4 | add a due date | Setting the date picker writes `due: 2026-07-01` to the entry header. |
| 5 | mute 🔇 | Clicking mute adds a `muted:` tag to the entry. |

## Discussion view — right column, goal row

| # | Test | Expected behaviour |
|---|------|--------------------|
| 6 | achieve ✓ | Adds `achievedgoal` tag and an `Achieved:` marker. |
| 7 | cancel ✕ | Adds `canceledgoal` tag and a `Canceled:` marker. |
| 8 | add an activity | ⚡ writes a `Goal Actions` section with the bullet. |

## Kanban board

| # | Test | Expected behaviour |
|---|------|--------------------|
| 9 | drag card → CHK column | Sets `checktask` on the dragged task. |
| 10 | drag card → DONE column | Sets `resolvedtask` and writes a `Resolved:` marker. |

## All Tasks page

| # | Test | Expected behaviour |
|---|------|--------------------|
| 11 | change state → HOLD | State square → HOLD sets `onholdtask`. |
| 12 | change priority | Priority square cycles the priority tag. |
| 13 | add an activity | ⚡ writes an action bullet. |
| 14 🟠 | mute dims + sends to bottom | Muting reduces the card opacity (dimmed, like done tasks) and moves it to the bottom of the list. |

## Ro3 (Rule of Three) page

| # | Test | Expected behaviour |
|---|------|--------------------|
| 15 | change state → WIP | State change on a focus card persists `inprogresstask`. |
| 16 | change priority | Priority change persists (file content changes). |
| 17 🟠 | mute removes + backfills | Muting a focus card removes it and a replacement slides in (still 3 cards). |
| 18 | add an activity | ⚡ modal submits and closes without error. |
| 19 | add a due date (via discussion) | Due set on the focus task's discussion writes `due: 2026-08-15`. |

## All Comments page  (`comments.spec.mjs`)

| # | Test | Expected behaviour |
|---|------|--------------------|
| 20 | aggregates all discussions | Shows entries from more than one discussion (Maria + James labels). |
| 21 | search `#tag` | `#task` shows task entries, hides plain comments. |
| 22 | search `@name` | `@[Priya Nair]` shows the entry referencing that name. |
| 23 | search freetext | A word shows matching entries, hides others. |
| 24 | move comment | Comment leaves source `.md`, appears in target with a `Moved from` marker. |
| 25 | delete comment | Comment is removed from its `.md`. |
| 26 🔵 | edit comment body | Editing (discussion view) persists the new text. |

## Cross-view search & aggregation  (`search.spec.mjs`)

| # | Test | Expected behaviour |
|---|------|--------------------|
| 27 | unified `#tag` filter | All Comments filtered to task entries. |
| 28 | Tasks cross-view aggregates | All Tasks shows tasks from multiple discussions. |
| 29 | Ro3 surfaces ≤ 3 | Ro3 renders between 1 and 3 focus tasks. |

## Lifecycle workflows  (`tasks.spec.mjs`)

| # | Test | Expected behaviour |
|---|------|--------------------|
| 30 | achieve goal + linked comment | Goal → `achievedgoal` + `Achieved:`; the linked comment keeps the `goal-<id>` (id appears ≥ 2×). |
| 31 | resolve followup | Followup → `resolvedfollowup` + `Resolved:` marker. |

## Safety boundaries  (`security.spec.mjs`)

| # | Test | Expected behaviour |
|---|------|--------------------|
| 32 | DOMPurify sanitises | A `<script>` / `onerror` payload neither executes (`window.__xss` unset) nor leaves a `<script>` node. |
| 33 | image path traversal rejected | `getImageUrl('../escape.jpg')` returns `null`. |

---

## Identified gaps (candidate tests not yet covered)

**Task / goal state coverage**
- State transitions never exercised via UI: **PRGT** (purgatory), **OBSL** (obsolete), and resetting back to **OPEN**.
- **Unmute** (toggling mute off) — only muting is tested.
- Full **priority cycle** (high → medium → low → high), and **clearing** a due date (empty value).
- Followup moved to WIP/HOLD (only resolve is tested).

**Kanban**
- Drag to WIP / HOLD / PRGT / OBSL columns (only CHK and DONE).
- Dragging a **followup** card; the DONE column's ~2-month recency filter.
- Muted cards dimmed/excluded on the kanban.

**Creation (currently seeded via the store, not the UI)**
- Creating a comment through the **compose form** (textarea, #tag/@name autocomplete, goal-link, due, Save).
- Creating a **discussion** — no UI exists yet (app gap).
- **Image paste** (clipboard → per-discussion subfolder) and image rendering / gallery carousel.

**Other pages / features with no tests**
- **Goals** cross-view page (All Goals) interactions.
- **Links** page (dedupe, rename link / R44), **Names** page, **Tags** page.
- **Activity** dashboard charts; **AI Summary** screen.
- **Theme** toggle (light/dark), **slim/responsive** mode.
- Sidebar: **favorite** toggle, **archive** discussion, discussion search/filter.
- **Preparation** notes edit; **rename** discussion.
- Ro3 **↻ Refresh** re-roll; "Updated:" marker when an entry is edited on a later day.

**Robustness notes on existing tests**
- #16 (Ro3 priority) asserts only "file changed", not the specific new priority (Ro3 picks are seed-dependent).
- #18 (Ro3 activity) asserts only that the modal closes, not the persisted bullet (focus card's discussion is dynamic).
- #26 (edit) selectors for the inline edit textarea/save are unconfirmed (🔵).
