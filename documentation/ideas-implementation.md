# Ideas Feature — Implementation Proposal

## Executive Summary

This proposal details the technical implementation of Ideas in Chippy. Ideas are a new entry type stored in the same unified data model as tasks, goals, and observations. They carry a state machine (Considered → Explored → Promoted/Shelved) and integrate seamlessly with existing search, filtering, and UI patterns.

Estimated effort: **3–4 sprints** (Phase 1 + Phase 2 core implementation).

---

## 1. Data Model & Storage

### 1.1 Reserved Tags

Add to the notebook format spec (`datadefinition.md`):

| Tag | Meaning |
|---|---|
| `idea` | Classifies entry as an idea. |
| `consideredidea` | Idea state: Considered (default; tag is optional). |
| `exploredidea` | Idea state: Explored. |
| `promoteditea` | Idea state: Promoted. |
| `shelvedidea` | Idea state: Shelved. |

The state machine enforces:
- An idea entry has **exactly one state tag** at a time (or no tag, read as Considered).
- Only idea entries carry idea-state tags.
- Legacy tags `idea-considered`, `idea-explored`, etc. are not supported.

### 1.2 Entry Header Format (No Changes)

Ideas use the same header format as tasks and goals:

```markdown
### 2026-03-01 14:30 | tags: idea, technical, career
Mentor junior devs on architecture patterns and design reviews.
```

Optional fields (goal link, due date) apply to ideas:

```markdown
### 2026-03-01 14:30 | tags: idea, high | due: 2026-03-15
Explore async/await migration for data pipeline.

### 2026-03-01 14:35 | tags: idea, exploredidea | goal: Technical excellence in team
Build a pair-programming session series for code review skills.
```

### 1.3 Entry Body Format (No Changes)

Ideas use the same three-part body model as tasks and goals:
1. Comment text
2. Optional `Updated: <timestamp>` line (edits on a different calendar day)
3. **Idea Actions** section (state transitions and promotions logged here)

Example:

```markdown
### 2026-03-01 14:30 | tags: idea, technical, exploredidea
Mentor junior devs on architecture patterns and design reviews.

Discussed with team lead; shared ref materials. Three people interested.

Idea Actions
- 2026-03-01 : Initial capture during check-in.
- 2026-03-05 : Explored; shared architecture doc with team.
- 2026-03-08 : → Promoted to task: "Plan mentorship series".
```

State transitions append a bullet: `- <YYYY-MM-DD> : → <STATE_LABEL>`, where labels are:
- `Considered`
- `Explored`
- `Promoted`
- `Shelved`

---

## 2. Backend Logic (Scripts & Parsing)

### 2.1 Update `list_dev_tasks.py`

**Goal**: Ensure the dev-task-runner script correctly skips idea entries when building the task queue.

**Changes**:
- Add `idea` to the reserved-tag list.
- Ensure `list_dev_tasks.py` filters to entries with `task` tag AND `dev` tag, excluding those with `idea` tag.
- No changes needed to the default filter logic (ideas are not tasks).

**Test cases**:
- Queue should NOT include entries tagged `#idea`.
- Queue should include `#task #dev` entries regardless of other tags.

### 2.2 Update `update_dev_task.py`

**Goal**: Ensure the state-mutation script doesn't touch idea entries.

**Changes**:
- Reject mutations if the target entry has `idea` tag (exit code 3: "cannot mutate idea entry").
- Keep task and goal state mutation logic unchanged.

### 2.3 Update `save_dev_task.py`

**Goal**: Allow capturing ideas as HOLD entries via capture mode.

**Changes**:
- Add a `--type` flag: `--type idea` (defaults to `task` if omitted).
- When `--type idea`, set tag `#idea #onholdidea` instead of `#task`.
- Enforce: `--state` flag is ignored if `--type idea` (ideas always start HOLD).
- HOLD for ideas is represented as `onholdidea` (using the same schema as onhold tasks).

**Example**:
```bash
python save_dev_task.py --emit --type idea \
    --title "Explore container-native monitoring" \
    --body "Check out Prometheus + Grafana stack for K8s deployments." \
    --tag dev --priority medium
```

### 2.4 Update Notebook Format Spec

Add to `references/notebook-format.md`:

```markdown
### Idea States

Ideas progress through a simple state machine:

| State | Label | Tag |
|---|---|---|
| Considered | Considered | `consideredidea` (or no state tag) |
| Explored | Explored | `exploredidea` |
| Promoted | Promoted | `promoteditea` |
| Shelved | Shelved | `shelvedidea` |

State transitions are logged in the **Idea Actions** section at the end of the entry body:

- YYYY-MM-DD : → <STATE_LABEL>

An idea that transitions to a task or goal should note the promotion:

- YYYY-MM-DD : Promoted to task: <task first line> or Spawned goal: <goal first line>
```

---

## 3. Frontend UI Components

### 3.1 New UI Elements

#### 3.1.1 Right Panel: "Open Ideas" Widget

**Location**: Right column, below "Open Tasks" (or as a collapsible section).

**Content**:
- Header: "Open Ideas" (count of non-shelved ideas)
- Sortable list (by creation date, state, priority):
  - Entry first line (single line, text truncated)
  - State label (Considered / Explored / Shelved) as a small colored badge
  - Priority dot (if present: high/medium/low)
  - Clickable to jump to entry in history
  - Hover action button (⚡) to open state-transition menu

**State Transition Menu** (icon: ⚡ or dropdown):
- Radio buttons: "Considered" / "Explored" / "Shelved"
- Confirm button to apply state change
- On confirm, calls `updateEntryState()` with new state tag and appends action bullet

**Keyboard shortcut** (optional): `Shift+I` to focus the Open Ideas list.

**Example UI**:
```
Open Ideas (5)
─────────────────
Mentor mentorship series [Explored] 🟡
  (Jump to) ⚡ (state menu)
  
Build code review guild [Considered]
  (Jump to) ⚡ (state menu)

Explore container monitoring [Shelved] (collapsed)
```

#### 3.1.2 History Entry Rendering

**For Considered/Explored ideas**:
- Render like regular entries (full text).
- Icon in the left margin (💡 or custom icon) to distinguish from observations/tasks/goals.
- State badge (small tag) to the right of the timestamp.

**For Shelved ideas**:
- Collapse to first line.
- Gray text / reduced opacity.
- Show state badge (Shelved).
- Expand triangle to show full text on click.

**Example**:
```
2026-03-01 14:30 | Mentor junior devs on architecture patterns [Explored] 💡
(full text visible)

─────────────────────

2026-02-28 09:00 | Explore async migration proposal [Shelved] 💡 ▶
(first line only; expand triangle shown)
```

#### 3.1.3 Tag Rendering in History

Ideas can have multiple classification tags (e.g., `career`, `technical`). Render these as chips alongside the state tag, consistent with task/goal rendering:

```
2026-03-01 14:30 | tags: idea, technical, career | due: 2026-03-10
[Explored] [technical] [career]
Mentor junior devs on architecture patterns and design reviews.
```

### 3.2 Existing Views — Ideas Integration

#### 3.2.1 All Comments (Cross-Discussion)

**Change**:
- Include ideas in the list (currently shows all entries except tasks and goals).
- Add filter chip "Ideas" (toggled by the icon 💡 or a checkbox).
- Apply the same entry-type filter logic: when "Ideas" is selected, show only `#idea` entries.

**Search**:
- `#idea` filters to ideas only.
- Combine `#idea #technical` to show ideas tagged with both.

#### 3.2.2 All Tasks

**Change**:
- Exclude ideas (no change; current code already filters to `#task`).
- Optionally add a "Show Ideas" toggle to include ideas in the same list (future enhancement).

#### 3.2.3 Activity Dashboard

**Changes**:
- Pie chart: Add a slice for ideas (count of `#idea` entries).
- Timeline chart: Add a line for "Ideas Created" (count by month).
- Bar chart: Add a section showing idea state distribution (Considered / Explored / Shelved).

**Example pie chart labels**:
- Comments: 42
- Tasks: 18
- Goals: 5
- **Ideas: 12** (new)

#### 3.2.4 Search Box (All List Views)

**Changes**:
- `#idea` tag filter is automatically recognized.
- `#idea:explored` or `#state:explored` for idea-specific state filters (parse as a search-enhancement; not required for v1).

**Example searches**:
- `#idea` → all ideas
- `#idea #technical` → ideas tagged technical
- `#idea @[Alice]` → ideas mentioning Alice

#### 3.2.5 Kanban Board (Stretch Goal)

**Optional v2 enhancement**:
- Add a toggle "Show Ideas as Column" (checkbox in Kanban settings).
- When enabled, add a fourth column: "Ideas" → "Explored" → "Promoted/Shelved".
- Drag-and-drop to transition state (same as task states).
- Initially OFF by default to avoid clutter.

### 3.3 New Cross-Discussion Page: All Ideas (Stretch)

**Location**: Sidebar navigation, alongside All Tasks, All Goals, etc.

**Content**:
- List of all ideas across all discussions.
- State-based tabs: Considered / Explored / Shelved.
- Sortable by: creation date, discussion, priority.
- Search and filter (same syntax as All Comments).

**Example UI**:
```
All Ideas
┌─────────────────────────────────────────┐
│ Considered | Explored (3) | Shelved | ALL │
├─────────────────────────────────────────┤
│ [#idea #technical]                      │
│                                         │
│ • Build code review guild               │
│   Alice Johnson · 2026-03-05            │
│                                         │
│ • Explore async migration proposal      │
│   Bob Smith · 2026-03-02                │
│                                         │
│ • Mentorship series for architecture   │
│   Alice Johnson · 2026-03-01            │
└─────────────────────────────────────────┘
```

---

## 4. State Management & Store Actions

### 4.1 New Store Actions

```javascript
// Update idea state (Considered → Explored → Promoted/Shelved)
store.updateIdeaState(discussionName, createdAt, newState)
  // Params:
  // - discussionName: string
  // - createdAt: YYYY-MM-DD HH:MM:SS
  // - newState: 'considered' | 'explored' | 'promoted' | 'shelved'
  // Returns: { success: bool, error?: string }

// Promote idea to task (creates new task entry, updates idea with action bullet)
store.promoteIdeaToTask(discussionName, createdAt, taskTitle, taskBody)
  // Params:
  // - discussionName: string
  // - createdAt: YYYY-MM-DD HH:MM:SS (of idea)
  // - taskTitle: string (first line of new task)
  // - taskBody: string (optional body for new task)
  // Returns: { success: bool, newTaskCreatedAt?: string, error?: string }

// Promote idea to goal (similar to task)
store.promoteIdeaToGoal(discussionName, createdAt, goalTitle, goalBody)
```

### 4.2 Selectors (State Queries)

```javascript
// Get all ideas in a discussion
store.getIdeasInDiscussion(discussionName)
  // Returns: Array<{ createdAt, text, state, tags, priority, dueDate }>

// Get all open ideas (Considered + Explored)
store.getOpenIdeas()
  // Returns: Array<{ discussionName, createdAt, text, state, ... }>

// Get idea count by state
store.getIdeaStateDistribution()
  // Returns: { considered: N, explored: N, promoted: N, shelved: N }
```

### 4.3 Subscribers (Reactive Updates)

```javascript
// Fired when an idea's state changes
store.subscribe('ideaStateChanged', callback)
  // Callback args: { discussionName, createdAt, oldState, newState }

// Fired when an idea is promoted to task/goal
store.subscribe('ideaPromoted', callback)
  // Callback args: { discussionName, createdAt, targetType, targetCreatedAt }
```

---

## 5. File I/O Operations

### 5.1 State Transition (MdIO.updateEntryState)

**Behavior**:
- Read the discussion file.
- Locate entry by `createdAt`.
- Strip old state tag (`consideredidea`, `exploredidea`, `promoteditea`, `shelvedidea`).
- Add new state tag.
- Append action bullet to Idea Actions section: `- YYYY-MM-DD : → <LABEL>`.
- Write file back.

**Pseudocode**:
```javascript
MdIO.updateEntryState(path, createdAt, newState) {
  const content = fs.readFileSync(path, 'utf-8');
  const entry = MdIO.findEntryByCreatedAt(content, createdAt);
  if (!entry) throw new Error(`Entry ${createdAt} not found`);
  
  const oldState = extractStateTag(entry.tags); // e.g., 'exploredidea'
  const newTags = entry.tags
    .filter(t => !isIdeaStateTag(t))
    .concat(mapStateToTag(newState)); // e.g., 'shelvedidea'
  
  const newEntry = {
    ...entry,
    tags: newTags,
    body: appendActionBullet(entry.body, `→ ${mapStateToLabel(newState)}`)
  };
  
  const newContent = MdIO.updateEntry(content, createdAt, newEntry);
  fs.writeFileSync(path, newContent);
}
```

### 5.2 Promotion to Task

**Behavior**:
- Create a new task entry in the same discussion (or optionally a different one).
- Update the idea entry:
  - Add state tag `promoteditea`.
  - Append action bullet: `- YYYY-MM-DD : Promoted to task: <task first line> (created YYYY-MM-DD HH:MM:SS)`.
- Both files (if different) are written back.

### 5.3 Bulk Loading Ideas (at Folder Open)

**Change to MdIO.loadDiscussion()**:
- When parsing entries, preserve `idea` tag (currently skipped or treated as a classification tag).
- State tags for ideas (`consideredidea`, `exploredidea`, etc.) are preserved like task state tags.

**No change required to the YAML parsing or index logic.**

---

## 6. Migration & Backward Compatibility

### 6.1 Existing Discussions

Existing `.md` files are unaffected. Ideas are purely additive:
- New entries can be tagged `#idea` in existing discussions without breaking the app.
- Old discussions with no ideas continue to work unchanged.

### 6.2 Navigation Index

**No changes to `navigation.md` required** — ideas are stored as entries alongside tasks/goals.

### 6.3 Tags Index

**No changes to `tags.md` required** — the `idea` tag and state tags are preserved like any other tag.

---

## 7. Implementation Phases

### Phase 1: Data Model & Core Rendering (1 sprint)

**Tasks**:
1. Update `datadefinition.md` with idea tags and Idea Actions format.
2. Update `list_dev_tasks.py` to skip idea entries in the task queue.
3. Update `save_dev_task.py` to support `--type idea` flag.
4. Modify `MdIO.js` to parse and preserve idea state tags.
5. Render ideas in history (with icon and state badge).
6. Basic rendering of shelved ideas (collapsed to first line).

**Acceptance Criteria**:
- Ideas can be created with the `#idea` tag.
- Ideas appear in history with distinct styling.
- State tags are parsed and preserved.
- Dev-task-runner correctly ignores ideas.

### Phase 2: UI Widgets & State Management (1.5 sprints)

**Tasks**:
1. Build "Open Ideas" right-panel widget.
2. Implement state-transition menu (⚡ button).
3. Add `updateIdeaState()` store action and file I/O.
4. Update existing views (All Comments, Activity Dashboard) to show ideas.
5. Add search filter `#idea` to all list views.
6. Test state transitions and action-log appending.

**Acceptance Criteria**:
- Ideas appear in the right panel.
- State transitions work and log action bullets.
- Ideas are searchable with `#idea` filter.
- Activity dashboard includes idea metrics.

### Phase 3: Cross-Discussion Integration (1 sprint)

**Tasks**:
1. Add "All Ideas" cross-discussion view (optional for v1).
2. Integrate ideas into the unified search syntax.
3. Add idea state filter to All Comments and other list views.
4. Test filtering and sorting ideas by state/priority/date.
5. Update help dialog with idea explanation.

**Acceptance Criteria**:
- Ideas appear in All Comments with toggle.
- `#idea` and `#idea:explored` searches work.
- All Ideas page (if built) lists and filters correctly.

### Phase 4: Polish & Stretch Goals (0.5–1 sprint, optional)

**Tasks**:
1. Implement Kanban column for ideas (toggle in settings).
2. Add interest-level indicator (comment count).
3. Implement "All Ideas Mentioning [Name]" cross-discussion view.
4. Performance testing with large idea counts.

**Acceptance Criteria**:
- Kanban board optionally shows ideas.
- Interest levels are computed and displayed.
- App remains performant with 50+ ideas per discussion.

---

## 8. Testing Strategy

### 8.1 Unit Tests

- **Parser**: Verify `#idea` tags and state tags are extracted correctly.
- **State machine**: Confirm valid state transitions; reject invalid ones (e.g., Promoted → Considered).
- **Action log**: Verify action bullets are appended with correct format.

### 8.2 Integration Tests

- **Dev-task-runner**: Confirm ideas are excluded from task queues.
- **File I/O**: Create, read, modify ideas without losing data.
- **Concurrency**: State transitions don't corrupt concurrent edits.

### 8.3 E2E Tests (Playwright)

- **Idea creation**: Capture an idea via `#idea` tag; verify it appears in Open Ideas.
- **State transitions**: Change state from Considered → Explored → Shelved; verify badges update.
- **Promotion**: Promote an idea to a task; verify task is created and action log updated.
- **Search**: Filter ideas by `#idea #technical`; verify results.
- **History rendering**: Shelved ideas collapse correctly; unshelved ideas expand.

### 8.4 Manual Smoke Tests

- Open an existing discussion; create an idea; refresh the app; verify persistence.
- Search across discussions for `#idea`; verify cross-discussion results.
- Check Activity Dashboard metrics for ideas.

---

## 9. Documentation Updates

### 9.1 User Documentation

- **Help dialog**: Add idea description and lifecycle (Considered → Explored → Shelved/Promoted).
- **Quick-start guide**: Example of capturing and promoting an idea.
- **Tag reference**: Document `#idea` and idea state tags.

### 9.2 Developer Documentation

- **SKILL.md** (dev-task-runner): Document that ideas are excluded from auto-run queues.
- **datadefinition.md**: Add idea data model, tags, and state machine.
- **README.md** (architecture): Mention ideas as a new entry type alongside tasks/goals.

---

## 10. Rollout & Adoption

### 10.1 Gradual Rollout

1. **Week 1**: Ship Phase 1 (data model). Users can create ideas manually; basic rendering.
2. **Week 2–3**: Ship Phase 2 (UI widgets, state transitions).
3. **Week 4**: Ship Phase 3 (cross-discussion views, search integration).
4. **Week 5+**: Optional Phase 4 (Kanban, interest levels, AI features).

### 10.2 User Onboarding

- In-app notification: "New feature: Ideas! Capture possibilities without committing to tasks."
- Link to help dialog with example use cases.
- Suggest users create a few ideas to familiarize themselves.

### 10.3 Success Metrics

- Number of ideas created per team member per week.
- Promotion rate (ideas → tasks or goals).
- User feedback on idea lifecycle clarity and value.
- Retention of users who create ideas.

---

## 11. Appendix: Example Workflow

**Scenario**: Team lead (Alice) has a check-in with Bob (engineer).

1. **Capture**: Bob suggests, "We could pair-program the API refactor." Alice types:
   ```
   Bob mentioned pairing on API refactor to improve knowledge sharing.
   #idea #technical
   ```
   App tags it `#idea` and registers it in "Open Ideas."

2. **Explore**: One week later, Alice discusses with the tech lead, who thinks it's valuable. Alice transitions the idea from Considered → Explored. Action log updates:
   ```
   Idea Actions
   - 2026-03-01 : Initial capture during check-in.
   - 2026-03-08 : → Explored
   ```

3. **Promote**: Two weeks later, Alice decides to schedule the pair-programming sessions. She promotes the idea to a task via the UI:
   ```
   New task created: "Plan and schedule pair-programming sessions for API refactor"
   Idea action logged: "Promoted to task: Plan and schedule pair-programming sessions (created 2026-03-15 10:00)"
   Idea state updated to: Promoted
   ```

4. **Track**: The task appears in Open Tasks and the Kanban board. The idea remains in history with a breadcrumb linking to the task. Both are visible in the Activity Dashboard, showing the lifecycle.

---

## 12. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Ideas clutter the history | Shelved ideas collapse by default; toggle to expand. Users can archive discussions if needed. |
| Low adoption | In-app onboarding + clear use-case messaging. Start with Phase 1/2 to show value quickly. |
| Performance impact | Profile with 100+ ideas; lazy-load cross-discussion pages if needed. |
| Confusion with tasks/goals | Clear visual distinction (💡 icon) + tooltips. Help dialog explains lifecycle. |
| State-machine complexity | Start with 2 states (Considered / Shelved); add Explored and Promoted in v2. |

---

## Conclusion

Ideas integrate naturally into Chippy's existing architecture without breaking changes. They fill a gap between raw observations and committed tasks, enabling the team lead to capture more context and make better-informed decisions over time. Phased implementation allows for rapid user feedback and iterative refinement.
