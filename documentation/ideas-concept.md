# Ideas in Chippy — Concept Document

## Overview

**Ideas** are a new entry type in Chippy that sit between raw observations and concrete commitments. They capture emerging thoughts, possibilities, and suggestions that deserve tracking but aren't yet actionable tasks or strategically-aligned goals.

An idea is:
- **Low-friction to record** — capture a thought in seconds without committing to execution
- **Exploratory** — a seed to be considered, discussed, and potentially developed into a task or goal
- **Trackable** — integrated into search, filtering, and cross-discussion views alongside tasks and goals
- **Iterative** — evolve over time as context accumulates; can be promoted to a task or shelved

## Problem Statement

In Chippy today:
- **Observations** and **feedback** are loosely tracked with no follow-up mechanism. They live in the history but lack explicit intent.
- **Tasks** require immediate commitment: creating a task signals "this will be done." A half-formed thought doesn't belong here.
- **Goals** require strategic alignment and a due date. Not every idea warrants that level of commitment.

Result: Mid-level insights and possibilities get lost. The team lead captures them as ad-hoc notes that don't surface in searches or the activity dashboard.

## Use Cases

1. **During check-ins**: A team member suggests a training approach or a project optimization. The lead wants to surface it later without immediately assigning it as a task.

2. **Cross-discussion insights**: The lead notices a pattern emerging across multiple team members (e.g., "three people mentioned data quality concerns"). Want to track this as an idea before deciding how to act.

3. **Low-priority possibilities**: "Could pair-program the refactor" or "might explore this tool" — valuable context, not a commitment.

4. **Idea incubation**: An idea gets several comments over weeks (each tagged `#idea`). Over time, it clarifies into a concrete task or remains shelved.

## How Ideas Differ from Existing Entry Types

| Aspect | Observation/Feedback | Idea | Task | Goal |
|--------|----------------------|------|------|------|
| **Intent** | Capture fact or feedback | Explore a possibility | Commit to action | Align on direction |
| **Commitment level** | None | Optional | Strong | Strategic |
| **State machine** | None | Considered → Explored → Promoted/Shelved | 7-state workflow (OPEN → DONE) | 3-state (Open → Achieved/Canceled) |
| **Due date** | Not applicable | Optional | Often | Required |
| **Metrics** | Last-seen date | Interest level, comment count | Priority, age | Progress %, due date |
| **Lifecycle** | Stays in history | Evolves; can promote to task | Executes; closes as DONE | Tracks toward milestone |

## Data Model

Ideas are stored as entries with the reserved tag `#idea`. Like tasks and goals, they carry:
- Timestamp (creation date)
- Freeform text body
- Multi-tag classification (e.g., `career`, `technical`)
- Optional due date (for follow-up discussion)
- Optional linked goal (if the idea supports an existing goal)
- State tag (see below)
- Action log (like tasks and goals)

## Idea Lifecycle & States

Ideas transition through a simple state machine with three states:

### 1. **Considered** (default, no state tag)
- Idea is captured and registered.
- Appears in idea lists and searches.
- Ready for team discussion or personal reflection.

### 2. **Explored** (tag: `exploredidea`)
- Idea has been discussed, refined, or researched.
- More context added; may have follow-up comments or linked tasks/goals.
- Still not decided whether to promote or shelve.

### 3. **Promoted** (tag: `promoteditea`)
- Idea has graduated to a concrete task or goal.
- Remains visible in history with a note of what it became.
- Typically accompanied by an action bullet linking to the task/goal.

### 4. **Shelved** (tag: `shelvedidea`)
- Idea is deprioritized or deemed not viable at this time.
- Remains searchable and visible in history; collapsed with reduced opacity in lists.
- Can be unshelved if circumstances change.

**State transitions:**

```
Considered → Explored → Promoted (or Shelved)
           ↘ Shelved (direct)
Shelved → Considered (unshelve)
```

## UI/UX Principles

1. **Low-friction input**: Ideas are created the same way as tasks/goals — type the thought, tag it `#idea`, done.

2. **Integrated into existing views**:
   - **History**: Ideas appear chronologically alongside other entries; collapsed to first line if shelved.
   - **All Comments**: Cross-discussion ideas can be searched and filtered.
   - **Search syntax**: Support `#idea` tag filter in all list views.
   - **Activity dashboard**: Pie chart slice for idea counts; timeline shows idea creation/state change rate.

3. **Right panel widget** (when in a discussion):
   - New "Open Ideas" section listing all `#idea` entries with state tags.
   - Each idea shows: first line, state label (Considered/Explored/Shelved), optional action button to transition state.
   - Clickable to jump to the idea's position in history (like tasks/goals).

4. **Kanban board** (optional expansion):
   - Ideas can optionally appear in the Kanban board as a fourth column (Considered → Explored → Promoted/Shelved).
   - Drag-and-drop to transition state.
   - Initially off by default; controlled by a checkbox in the Kanban view.

5. **Interest level indicator** (stretch):
   - Each idea displays a count of how many times it's been commented on or linked.
   - Visual hint (e.g., a number or bar) showing which ideas are generating discussion.

## Integration Points

### With Tasks
- An idea can be promoted directly to a task. The action log records the link: `Promoted to task: <task title> (created <timestamp>)`.
- A task can reference an idea if it originates from one: `Derived from idea: <idea first line>` in the action log.

### With Goals
- An idea can be linked to an existing goal (same mechanism as tasks/comments).
- If an idea spawns a goal, the action log notes it: `Spawned goal: <goal title>`.

### With Names & References
- Ideas can mention people via `@[Name]` syntax (like all entries).
- A cross-discussion "All Ideas Mentioning [Name]" view is possible (out of scope for v1).

### With Search & Filtering
- Unified search syntax: `#idea` filters to ideas; can combine with `#state:explored` or other tags.
- Ideas appear in the global "All Comments" view (cross-discussion).
- Can be filtered by discussion tag in the same way as tasks/goals.

## Benefits

1. **Capture more context**: The lead no longer loses mid-level insights to informal notes.
2. **Reduce meeting friction**: Ideas can be quickly logged and revisited asynchronously.
3. **Better activity metrics**: Track how many ideas emerge (creativity signal) and which are promoted (execution signal).
4. **Clearer decision trail**: The action log shows which ideas became tasks, which were shelved, and why.
5. **Cross-discussion patterns**: Ideas are searchable and visible globally, making patterns easier to spot.

## Non-Goals (Out of Scope for v1)

- Voting or ranking ideas across team members.
- Automatic promotion rules (ideas remain manual promotions).
- AI suggestions or idea generation.
- Idea templates or structured idea forms.
- Collaboration comments within ideas (ideas are append-only like all entries).

## Rollout Strategy

1. **Phase 1**: Add data model, tag schema, state machine, and basic entry rendering.
2. **Phase 2**: Add "Open Ideas" right-panel widget and state-transition UI.
3. **Phase 3**: Integrate ideas into All Comments, search, and activity dashboard.
4. **Phase 4** (optional): Add Kanban board column; consider interest-level indicators.

## Success Metrics

- Number of ideas captured per team member per cycle.
- Promotion rate (ideas → tasks or goals).
- Search queries involving ideas (e.g., `#idea #technical`).
- User feedback on idea lifecycle clarity.
