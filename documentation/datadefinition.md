# Notebook — Data Definition

On-disk data-format reference for the Personal Notebook app. It describes the data the app
stores and reads — the files, their layout, and the meaning of every field and value. It does
not describe code or rendering.

Everything is stored as plain Markdown in one user-selected folder. There is no database and no
configuration outside that folder. These file categories live at the folder root, plus
per-discussion image subfolders:

1. One `<DiscussionName>.md` per discussion — its content.
2. Three index files — `navigation.chippy.md` (the discussion list and theme),
   `tags.chippy.md` (the union of all tags), and `names.chippy.md` (known person names).
   Loaded on startup so the sidebar and autocomplete render without parsing any discussion.
3. One `summary.chippy.md` — AI-summary history plus the LLM API configuration (present once
   the Summary screen has been used).

All app-managed files share the `.chippy.md` suffix. Because discussion filenames are
sanitized to `[A-Za-z0-9_ -]` (dots are stripped), no discussion file can ever end in
`.chippy.md` — the two namespaces cannot collide, and `navigation`, `tags`, `names`, and
`summary` are ordinary discussion names.

Archived discussions are renamed `<DiscussionName>.archive.md` and are skipped when the folder
is loaded.

---

## 1. File naming and the data folder

- Each discussion is one `.md` file at the folder root. The filename is the discussion's
  display name with every character outside `[A-Za-z0-9_ -]` removed, followed by `.md`.
  Example: a discussion displayed as `R&D` is stored as `RD.md`, while the display name kept
  inside the file (`# R&D`) retains the ampersand.
- App-managed files (`navigation.chippy.md`, `tags.chippy.md`, `names.chippy.md`,
  `summary.chippy.md`) and any `*.archive.md` file are not treated as discussions.
- A file counts as a loadable discussion only when it ends in `.md` and does **not** end in
  `.archive.md` or `.chippy.md`. Discussions flagged as archived are excluded from the active
  list.
- Per-discussion images live in a subfolder whose name matches the sanitized discussion name.

---

## 2. The discussion `.md` file

```markdown
# Alice Johnson

## Preparation

- Discuss Q2 objectives
- Follow up on training plan

## Entries

### 2026-02-25 10:30 | tags: career
Discussed career progression path.

### 2026-02-25 10:40 | tags: task, high | due: 2026-03-05
Fix the deployment pipeline by end of sprint.

### 2026-02-25 11:00:12 | tags: task, resolvedtask, technical, low
Completed code review for PR #42.

Resolved: 2026-02-25 11:00:12

### 2026-02-26 09:00 | tags: goal, goal-a1b2c, high | due: 2026-06-30
Senior promotion — finalize scope and stakeholders.

### 2026-02-26 09:05 | tags: technical, goal-a1b2c | goal: Senior promotion — finalize scope and stakeholders.
Noticed strong collaboration in sprint review.
```

A discussion file has three blocks, always in this order: the title heading, `## Preparation`,
and `## Entries`. Entries are stored chronologically, oldest first (ordered by their
`created_at` timestamp). Goals, tasks, and followups are **not** separate sections — they are
ordinary entries distinguished by reserved tags.

**Title** — `# <discussion display name>`.

**Legacy metadata lines** — older files may carry `> Tag: <value>` (or the older `> Group:
<value>`) and `> Archived: true` directly after the title. Current files no longer store these;
per-discussion tag, archived, and favorite state live in `navigation.md` as the single source
of truth. The lines are still accepted when reading older files.

**`## Preparation`** — free-form preparation notes, one bullet (`- <line>`) per line. May be
empty.

**`## Entries`** — the body of the discussion. Each entry starts with a header line:

```
### <created_at> | tags: <comma-separated> | goal: <linked goal text> | due: <YYYY-MM-DD>
```

Only `created_at` is mandatory. `tags`, `goal`, and `due` are optional, pipe-separated fields,
each introduced by ` | ` (space-pipe-space).

Header fields:

- **created_at** — `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD HH:MM` for legacy reasons. This timestamp is the entry's stable identity
  within the file. Both widths are valid and preserved verbatim.
- **tags** — a comma-separated list. Order carries no meaning but is preserved when only a state
  or priority value changes. Reserved tags (section 2.2) drive behavior; any other tag is
  free-form.
- **goal** — the first line of a linked goal entry's text. Informational only; the actual link
  is carried by the goal's unique `goal-<id>` tag, not by this field.
- **due** — an ISO date, `YYYY-MM-DD`.

**Entry body** — every line between the header and the next `### ` header, with surrounding
whitespace trimmed. An entry whose body is empty is not retained. The body may contain Markdown
and image references.

### 2.1 Entry body conventions

Beyond free text, entry bodies carry a few conventional data artifacts. These are plain text,
not part of the header schema, and are stored as-is.

**Three-part body model.** A body consists of at most three things, in this canonical order,
blank-line separated: the **comment text**, the **`Updated:` line** (at most one), and the
**resolution-action log** (one section, always last). Editing an entry only ever replaces the
comment text — the other two parts are preserved untouched.

**The `Updated:` line** — a single line `Updated: <YYYY-MM-DD HH:MM:SS>` recording the most
recent edit made on a later calendar day than the entry's creation. On every subsequent edit
the existing line's timestamp is refreshed **in place** — a second `Updated:` line is never
added. (When reading older files that carry several `Updated:` lines, the most recent one wins
and the body is consolidated to a single line on the next write.)

**Resolution-action log** — a single section at the end of the body recording dated actions.
The header depends on entry type: `Task Resolution Actions` (task), `Followup Actions`
(followup), `Goal Actions` (goal), or `Idea Actions` (idea). Each action is a bullet `- YYYY-MM-DD : <text>` — date
only, one space on each side of the colon.

**State changes are logged here.** Every task, followup, goal, or idea state transition appends an
action bullet `- YYYY-MM-DD : → <LABEL>`, where `<LABEL>` is the state's display label (task
states `OPEN`, `WIP`, `CHK`, `HOLD`, `PRGT`, `DONE`, `OBSL`; goal states `Achieved`,
`Canceled`, `Open`; idea states `Considered`, `Explored`, `Promoted`, `Shelved`). The bullet does **not** carry the entry's state — the state is always the
state tag in the header (section 2.2); the bullet is only a human-readable record of *when*
the transition happened.

```markdown
Task Resolution Actions
- 2026-05-18 : Reworked the deployment pipeline; verified on staging.
- 2026-05-19 : Confirmed fix in production.
- 2026-05-19 : → DONE
```

**Legacy lifecycle markers** — older files carry single marker lines, each with a
`YYYY-MM-DD HH:MM:SS` timestamp, written before state changes moved into the action log:

- `Resolved: <ts>` — accompanied the `resolvedtask` tag (task state DONE), or `resolvedfollowup` for a followup.
- `Obsolete: <ts>` — accompanied the `obsoletetask` tag (task state OBSL).
- `Achieved: <ts>` — accompanied the `achievedgoal` tag (goal state Archived — see the naming note in section 2.2).
- `Canceled: <ts>` — accompanied the `canceledgoal` tag (goal state Canceled).

These markers are still **read** (e.g. as a close-date fallback when no `→ DONE`/`→ OBSL`
action bullet exists) and are preserved verbatim when an entry is rewritten, but **no new
state markers are ever written**. The only marker still written is the move marker:
`Moved from <source discussion>: <ts>` — the entry was moved from another discussion.

**Embedded data forms inside body text:**

- **Name reference** — `@[Full Name]`. Typing `@` (at the start of the text or after
  whitespace) is the trigger to enter a name; selecting one inserts the `@[Full Name]` form.
  This form is kept literally in the text (the `@` and brackets are storage markers) and is
  **not** a tag. Known names are listed in `names.md`. (There is no plain `@word` form — a bare
  `@` only ever starts a name reference.)
- **URLs** — stored as Markdown links `[label](url)`. A bare URL is normalized on save: if a
  word immediately precedes it, that word (with underscores turned into spaces) becomes the
  label; otherwise the label is the bare domain.
- **Images** — referenced as `![image](<DiscussionName>/yyyy-mm-dd hh-mm-ss.jpg)`.

### 2.2 Reserved tags

**Classification, priority, and parking tags:**

| Tag | Meaning |
|---|---|
| `task`, `followup` | Classifies the entry as a task or a followup. Open by default. |
| `goal` | Classifies the entry as a goal. |
| `goal-<5 chars>` | A goal's unique identity tag (a 5-character base-36 suffix). Copied onto every comment linked to that goal, forming the historical trail. |
| `idea` | Classifies the entry as an idea — an exploratory thought or possibility not yet committed as a task or goal. |
| `high`, `medium`, `low` | Priority. |
| `muted:<YYYY-MM-DD>` | Parking-lot mute marker; the encoded date is the auto-unmute expiry. |

**Task states.** A task's state is its state tag. There are seven states; the absence of any
state tag is read as OPEN (so `opentask` is rarely written explicitly).

| State | Label | Tag |
|---|---|---|
| Open | OPEN | `opentask` (or no state tag) |
| Work in Progress | WIP | `inprogresstask` |
| Check | CHK | `checktask` |
| Hold | HOLD | `onholdtask` |
| Purgatory | PRGT | `purgatorytask` |
| Done | DONE | `resolvedtask` |
| Obsolete | OBSL | `obsoletetask` |

`resolvedtask` and `obsoletetask` are the closed-state markers (used to collapse closed items
in history). A resolved **followup** uses `resolvedfollowup` in place of `resolvedtask`. The
legacy tags `inprogress`, `onhold`, and `purgatory` are accepted when reading old files but
never written.

**Goal states.** A goal's state is likewise carried by its tag. There are three states:

| State | Meaning | Tag |
|---|---|---|
| Goal | Open goal | `goal` (no closed-state tag) |
| Archived | The goal was executed / closed | `achievedgoal` |
| Canceled | The goal became irrelevant and was dropped | `canceledgoal` |

Naming note: the "Archived" state is stored as the `achievedgoal` tag and its body marker is
`Achieved:` — the human-facing label ("Archived") and the stored token (`achieved…`) differ;
the data uses the `achieved` form. The older `resolvedgoal` tag is still accepted on read.

**Idea states.** An idea's state is carried by its state tag. There are four states:

| State | Label | Tag |
|---|---|---|
| Considered | Entry is captured and under consideration | `consideredidea` (or no state tag) |
| Explored | Idea has been discussed or researched | `exploredidea` |
| Promoted | Idea has graduated to a task or goal | `promoteditea` |
| Shelved | Idea is deprioritized or deemed not viable | `shelvedidea` |

The absence of any state tag is read as Considered (so `consideredidea` is rarely written explicitly). A shelved idea may transition back to Considered if circumstances change (unshelving).

Value rules:

- A `task`, `followup`, or `goal` entry with no priority tag is stored as `low`.
- The absence of any state tag is read as OPEN (tasks), as an open goal, or as Considered (ideas).
- Every `goal` entry carries one unique `goal-<5 chars>` identity tag.

State, priority, `task`/`followup`, `idea`, and `muted:*` tags remain in the file but are hidden from
the on-screen tag chips.

### 2.3 Legacy `## Goals` section (read-only)

Files predating the 2026-03-03 goal-as-entry change may carry a `## Goals` section between
`## Preparation` and `## Entries`:

```markdown
## Goals

- [ ] Senior promotion | Due: 2026-06-30
- [x] AWS certification | Due: 2026-03-15
```

Each bullet represents a goal; a checked `[x]` box means resolved, and an optional `| Due:
<date>` supplies the due date. When such a file is loaded these become goal entries. The
section is never written back, so any re-saved file is normalized to the entries-only layout.

---

## 3. Index files

Three small index files at the folder root let the app render the sidebar and drive
autocomplete without parsing any discussion content. They are split by concern:
`navigation.chippy.md` (the discussion list and theme), `tags.chippy.md` (the tag union), and
`names.chippy.md` (known person names).

**Why these are persisted and not rebuilt at load.** Discussion files are loaded lazily — the
app does not read every discussion on startup, only what the user opens. The tag union and the
name list therefore cannot be reconstructed by scanning all discussions at launch without
defeating lazy loading, and application speed is the priority. So each index is an authoritative
persisted file, maintained incrementally as discussions and entries change, rather than a cache
regenerated on demand.

### 3.1 `navigation.chippy.md` — discussions and theme

```markdown
# Navigation

> theme: light

## Discussions

- Alice Johnson | tag: Team Members
- Bob Smith | tag: Team Members | favorite | archived
- Project Phoenix
```

**`> theme:`** — optional line; value `light` selects the light theme. Dark is the implicit
default and is not written.

**`## Discussions`** — one line per discussion, sorted alphabetically. Each line is `- <name>`
followed by optional pipe-separated flags:

- `| tag: <value>` — the sidebar group the discussion belongs to (omitted when empty).
- `| favorite` — the discussion is marked a favorite.
- `| archived` — the discussion is archived.

Per-discussion tag, archived, and favorite state are owned here (the single source of truth),
not in the discussion files.

### 3.2 `tags.chippy.md` — tag union

```markdown
# Tags

- career
- goal
- high
- task
```

A deduplicated, alphabetically sorted list of every tag in use across all discussions, under a
`## Tags`-style list (one `- <tag>` per line). Drives tag autocomplete and the sidebar tag
filters. Maintained incrementally: a tag is added when an entry first introduces it. Because
discussions are lazy-loaded, the list is not pruned by re-scanning all files.

### 3.3 `names.chippy.md` — known names

```markdown
# Names

- Anna Wehrli
- Philipp Sommer
```

A deduplicated, sorted list of known person names, one `- <name>` per line. These are the names
offered when typing `@` in an entry and stored as `@[Full Name]` references in body text.

### 3.4 Legacy layouts and the one-time migration

Two older folder layouts are recognized and migrated to the `.chippy.md` layout on first load.
The migration runs **only when no `navigation.chippy.md` exists yet**; once the new files are
present, files named `navigation.md`, `tags.md`, `names.md`, or `summary.md` are ordinary
discussions and are never read as indexes.

**Generation 2 (pre-v3.1 split layout).** The same three index files under their old names —
`navigation.md`, `tags.md`, `names.md` — plus an optional `summary.md`. On load, each is read,
written out under its `.chippy.md` name, and the legacy file is removed: effectively a rename.
A `summary` entry in the legacy discussion list (reserved-file pollution from old versions) is
dropped during the migration.

**Generation 1 (single-file layout).** Before the split, all three lists lived in a single
`navigation.md` with `## Discussions`, `## Tags`, and `## Names` sections:

```markdown
# Navigation

> theme: light

## Discussions

- Alice Johnson | tag: Team Members

## Tags

- career
- task

## Names

- Anna Wehrli
```

Both generations are handled in one pass when chippy loads, so existing folders keep working:

- **Read precedence.** A dedicated legacy `tags.md` / `names.md`, when present, is
  authoritative. When absent, the corresponding `## Tags` / `## Names` section inside the
  legacy `navigation.md` is read as the fallback source.
- **Discussions and theme** are always read from the legacy `navigation.md` regardless of
  generation.
- **Migration on load.** The data is written to `navigation.chippy.md`, `tags.chippy.md`, and
  `names.chippy.md` (and `summary.md` is renamed to `summary.chippy.md` when present); the
  legacy files are then removed. The migration therefore runs at most once per folder — after
  the first load, the folder is in the `.chippy.md` layout and the legacy names are free for
  ordinary discussions.

---

## 4. `summary.chippy.md` — AI summaries and API configuration

Optional file, present once the Summary screen has been used. It holds two things: the LLM API
configuration and the saved summaries.

```markdown
> api_url: http://127.0.0.1:1234/v1/chat/completions
> api_model: llama3

### 2026-05-10 09:14 | range: week | id: k8d2x | model: llama3 | tokens: 4123

OVERALL
…overall block…

DISCUSSION: Alice Johnson
SUMMARY: …
ACTIVITY: …
```

**Configuration lines** — `> api_url:` and `> api_model:` at the top of the file persist the
local LLM endpoint and model.

**Summary header** — `### <created_at> | range: <day|week|month> | id: <short id>` plus optional
`| model: <name>` and `| tokens: <int>`. The timestamp, `range`, and `id` are always present;
`model` and `tokens` are written when known.

**Summary body** — free-form text following the structured layout: an `OVERALL` block followed
by one `DISCUSSION:` / `SUMMARY:` / `ACTIVITY:` triple per discussion in scope. Stored verbatim,
so manual edits round-trip cleanly.

---

## 5. Images and folder layout

Images are stored per discussion in a subfolder named to match the (sanitized) discussion. Each
image filename is `yyyy-mm-dd hh-mm-ss.jpg`. Inside entry text, images are referenced as
`![image](<DiscussionName>/yyyy-mm-dd hh-mm-ss.jpg)`.

```
<data folder>\
├── navigation.chippy.md
├── tags.chippy.md
├── names.chippy.md
├── summary.chippy.md
├── Alice Johnson.md
├── Alice Johnson\
│   ├── 2026-02-25 10-30-45.jpg
│   └── 2026-03-01 14-22-10.jpg
├── Bob Smith.md
├── Bob Smith\
│   └── 2026-02-26 09-15-33.jpg
└── Project Phoenix.archive.md
```

**Image-reference validity** — a stored image path must be a relative path inside the data
folder. A reference is invalid if it is longer than 512 characters, begins with a path
separator or a drive letter, carries a URL scheme, or contains a segment that is `.`, `..`,
empty, holds a backslash, or holds a NUL character.

**Cascading data changes:**

- Renaming a discussion renames its `.md` file, renames the image subfolder, and rewrites every
  image reference inside the entries.
- Moving an entry between discussions moves the image files it references into the target's
  subfolder and updates the references.
- Deleting an entry that contains an image deletes that image file.
