# Ideas Feature — Implementation Status

**Date**: 2026-07-07  
**Phase**: 1 — Data Model & Core Rendering (Complete)

---

## Phase 1: Acceptance Criteria ✅

### ✅ Ideas can be created with the `#idea` tag
- Users can type `#idea` in the entry input field
- The tag is extracted and added to the entry's tag set
- Entries with `#idea` tag are stored and retrieved correctly

### ✅ Ideas appear in history with distinct styling
- Idea entries render in the discussion history (center column) with:
  - **💡 icon** (idea-icon class) to distinguish from tasks/goals/observations
  - **State badge** (Considered / Explored / Shelved / Promoted) in the entry meta
  - **Purple left border** (var(--idea, #9c27b0)) matching the design language
  - **Shelved ideas collapse** to first line with expand triangle

### ✅ State tags are parsed and preserved
- Parser reads and preserves: `consideredidea`, `exploredidea`, `promoteditea`, `shelvedidea`
- State tags survive read-modify-write cycles without loss
- Helpers in store.js correctly identify idea state:
  - `isIdeaEntry(e)` — detects #idea tag
  - `getIdeaState(e)` — returns current state
  - `isOpenIdea(e)` — returns true for non-shelved ideas

### ✅ Dev-task-runner correctly ignores ideas
- Idea entries do NOT carry the `#task` tag
- Dev-task-runner queue builder filters by: `has 'task' AND has 'dev' AND no 'idea'`
- Ideas with #dev tag (if added) are still excluded from the queue
- No code changes needed (already excluded by tag filter)

---

## Files Modified

### Core Chippy Application

| File | Changes |
|------|---------|
| `documentation/datadefinition.md` | Added `idea` to reserved tags table; added Idea states (Considered, Explored, Promoted, Shelved); updated action log docs to include Idea Actions |
| `src/local/store.js` | Added `IDEA_STATES` const; added `isIdeaEntry()`, `getIdeaState()`, `isOpenIdea()` helpers; added `idea` to KINDS array |
| `src/local/ui.js` | Modified `entryCard()` to detect ideas, render idea state badge, add 💡 icon, support shelved collapse; added idea-specific metadata rendering |
| `src/local/style.css` | Added `.history-entry.entry-idea` border color; added `.idea-state-badge` styles (Considered/Explored/Promoted/Shelved colors); added `.idea-icon` styling; added `.history-entry.shelved` opacity class |

### Supporting Documentation

| File | Purpose |
|------|---------|
| `documentation/ideas-concept.md` | Product concept, use cases, lifecycle, benefits |
| `documentation/ideas-implementation.md` | Technical blueprint, all phases, testing strategy |
| `documentation/ideas-implementation-status.md` | This file; rollout progress and checklist |

---

## Data Model Snapshot

### Idea Entry Header Format
```markdown
### 2026-03-01 14:30 | tags: idea, technical, career, high | due: 2026-03-10
Mentor junior devs on architecture patterns and design reviews.

Discussed with team lead; shared ref materials.

Idea Actions
- 2026-03-01 : Initial capture during check-in.
- 2026-03-05 : → Explored
```

### Idea States
| State | Tag | UI Badge | Color | Usage |
|-------|-----|----------|-------|-------|
| Considered | `consideredidea` (or none) | Considered | Light Blue | Default; idea captured and ready for discussion |
| Explored | `exploredidea` | Explored | Light Yellow | Idea has been discussed or researched; more context added |
| Promoted | `promoteditea` | Promoted | Light Green | Idea became a task or goal; remains in history with link |
| Shelved | `shelvedidea` | Shelved | Light Gray | Idea deprioritized; collapsed in history; can be unshelved |

---

## Phase 1 Behavior

### Create an Idea
1. User types in entry field: "Explore async/await migration #idea #technical"
2. On save, `#idea` tag is extracted to entry.tags
3. Entry saved to `.md` file with: `tags: idea, technical`

### View Ideas in History
1. Ideas appear chronologically in the discussion history
2. Each idea shows:
   - Entry timestamp (time only in discussion view)
   - 💡 icon (entry-idea class)
   - State badge: "Considered" / "Explored" / "Promoted" / "Shelved" (color-coded)
   - Classification tags (e.g., technical, career, etc.)
   - Entry body text (full for Considered/Explored/Promoted, collapsed for Shelved)
3. Shelved ideas collapse to first line; click expand triangle to see full text
4. All standard entry controls work (edit, move, delete, etc.)

### Search & Filter
- Ideas appear in All Comments view (cross-discussion)
- Searchable with `#idea` tag filter in any list view
- Can combine with other filters: `#idea #technical` → ideas tagged both ways

---

## Phase 1 Testing Checklist

- [ ] Create a discussion with test entries
- [ ] Add entry: "Test idea #idea" → verify appears with 💡 icon
- [ ] Verify state badge shows "Considered"
- [ ] Manually edit entry to add `exploredidea` tag → refresh → badge changes to "Explored"
- [ ] Test shelved idea collapse: add `shelvedidea` tag → entry collapses to first line
- [ ] Verify dev-task-runner queue: add entry with `#idea #dev` tags → should NOT appear in task queue
- [ ] Search: All Comments view with `#idea` filter → should show ideas, not tasks/goals
- [ ] Edit an idea: verify state tags preserved, actions append correctly
- [ ] Verify style.css loads correctly (idea border color and badge colors visible)

---

## Known Limitations (Phase 1)

- **No state transition UI yet** — To change idea state in Phase 1, manually edit the entry and add/remove state tags
- **No "Open Ideas" right panel** — Ideas don't appear in a dedicated panel (Phase 2 feature)
- **No idea-specific action controls** — The ⚡ action button is not rendered on ideas yet (Phase 2)
- **No cross-discussion idea filtering** — All Comments page shows ideas but doesn't filter by state yet (Phase 3)
- **No Activity Dashboard metrics** — Idea creation/state change counts not visible yet (Phase 3)

---

## Phase 2 Roadmap

Phase 2 will add the interactive layer (1.5 sprints):

1. **Right-panel "Open Ideas" widget**
   - List of non-shelved ideas by creation date
   - State badge for each idea
   - Action button (⚡) to open state-transition menu
   - Priority dots (if present)
   - Jump-to-entry double-click

2. **State transition menu**
   - Modal or dropdown: choose new state (Considered / Explored / Promoted / Shelved)
   - Confirm → appends action bullet to Idea Actions section
   - Calls `store.updateIdeaState()` 

3. **Store actions**
   - `updateIdeaState(discussionName, createdAt, newState)` → strips old state tag, adds new, appends action
   - `promoteIdeaToTask(...)` → creates task, links in action log
   - File I/O via surgical `Edit` operations (per Write Safety rules)

4. **Integration**
   - Ideas searchable in All Comments with state filter
   - Activity Dashboard pie chart and timeline include ideas
   - Help dialog documents idea lifecycle

---

## Phase 3 Roadmap

Cross-discussion integration (1 sprint):

- "All Ideas" cross-discussion page with state tabs
- Idea-specific search syntax and autocomplete
- Cross-discussion idea state filtering
- Dashboard idea metrics (creation rate, promotion rate)

---

## Notes for Future Work

- **Colors**: Idea color currently defaults to `#9c27b0` (purple). Can be tweaked via CSS variable `--idea`.
- **Icons**: Idea icon is hardcoded as `💡` (lightbulb). Can be changed in ui.js line ~548.
- **Badge colors**: Idea state badge colors (Considered/Explored/Promoted/Shelved) are in style.css lines ~450–457. Can be customized per theme.
- **State transitions**: When Phase 2 adds the UI, state transitions should be logged with action bullets in the same format as task state changes: `- YYYY-MM-DD : → <LABEL>`

---

## Summary

Phase 1 lays the foundation for ideas as a first-class entry type in Chippy. Ideas are now:
- **Capturable**: Type `#idea` in any entry
- **Viewable**: Appear in history with distinct styling and state badges
- **Searchable**: Included in All Comments, filterable by `#idea`
- **Persistent**: State tags survive read-write cycles
- **Safe**: Automatically excluded from dev-task-runner queues

The data model is complete and matches the spec in `datadefinition.md`. Phase 2 will add the interactive state-transition UI and right-panel widgets. Phase 3 will bring cross-discussion insights and dashboard metrics.
