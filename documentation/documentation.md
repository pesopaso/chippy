# Chippy (formerly: Personal Notebook / Personal Team Member Score Board)

## Meta

| Field    | Value                                  |
|----------|----------------------------------------|
| Date     | 2026-02-24                             |
| Time     | 05:40 UTC                              |
| Duration | ~55 min + 2 refinement rounds          |
| Gates    | 4 (all passed)                         |
| Agents   | 8                                      |
| Version  | 2.42                                   |
| Revision | 42 (favorites for discussions + toast notifications replace unsaved dialog) |

## Abstract

A local web tool for anyone who needs to stay on top of individual discussions, meeting series, or topics that evolve over a longer period — not only team leads. Managing bi-weekly check-ins with team members is one fitting use case, but so are recurring meeting series, ongoing projects, research threads, and any long-running topic worth tracking over time. Captures timestamped discussion entries with multi-tag classification, auto-associates entries to goals, provides a markdown-rendered preparation area for upcoming check-ins, tracks tag recency, manages tasks and followups with a seven-state workflow (open, in-progress, check, on-hold, purgatory, resolved, obsolete) and priority levels, supports a kanban board view, action logging via modal, clipboard image pasting, discussion archiving, named-person references (`@[Name]` chips with autocomplete and a cross-discussion All Names view), cross-discussion link aggregation with inline title editing, a Rule of Three (Ro3) page for random task selection by priority, an activity dashboard with pie charts/timeline/cumulative/balance charts, an AI Summary screen that consolidates discussion history via a configurable LLM endpoint, light and dark themes, a top chrome bar with a context-aware print button, a unified search syntax (`#tag`, `@[Name]`, freetext) across all list views, auto-saved entry drafts with orphan cleanup, responsive slim mode for narrow viewports, sidebar discussion search, and generates Markdown contribution summaries for mid-year and end-year reviews. Discussion content is rendered through DOMPurify with a tight allowlist and image paths are guarded against traversal. Data is stored as individual `.md` files per discussion in a local folder.

## Problem Statement

Notes for long-running discussions — bi-weekly check-ins, recurring meeting series, ongoing projects, or any topic that evolves over time — are typically scattered across tools like Trello card comments, chat threads, and loose documents. This does not scale: as the number of discussions and tracked aspects grows, observations get lost, entries can't be linked to goals automatically, task state and follow-ups are hard to keep track of, and summaries require tedious manual reconstruction from unstructured notes.

## Benefit Hypothesis

By replacing scattered, unstructured notes with a purpose-built tool that supports tagging, automatic goal-linking, task and followup tracking, aspect recency, and cross-discussion topic views, anyone keeping on top of evolving discussions — a team lead running check-ins, a facilitator tracking a meeting series, or someone following a long-running project or topic — will retain more context, surface what matters faster, and produce higher-quality summaries with far less manual effort.

## Open Source License

Chippy is released as open source under the **Apache License 2.0**.

- **License.** Apache-2.0. The full text is in [`LICENSE`](../LICENSE) at the project root; required attributions are in [`NOTICE`](../NOTICE).
- **Why Apache-2.0.** Permissive like MIT — free to use, modify, and redistribute as long as the copyright and license notices are preserved — but with two additions MIT lacks: an explicit patent grant from contributors, and a patent-retaliation clause (suing over the project's patents terminates your grant). It also aligns cleanly with the bundled third-party components.
- **Source headers.** Every source file carries an `// SPDX-License-Identifier: Apache-2.0` header, and modified files note the change (Apache-2.0 §4b).
- **Third-party components**, each retained under its own license with its notice kept alongside it:
  - DOMPurify — Apache-2.0 or MPL-2.0 (the HTML-sanitization boundary).
  - Roboto — Apache-2.0 (the UI typeface).
- **Copyright.** Copyright 2026 Philipp Sommer.

## Detailed Description

Chippy is a locally deployed, single-user web application designed for a team lead managing 15 direct reports through bi-weekly check-in discussions. The tool replaces the current workflow of capturing notes in Trello card comments, which has become insufficient for the complexity and volume of information generated across check-ins, ad-hoc observations, and third-party feedback.

All entries follow a **unified data model**. Every entry is a timestamped note with a text body and a set of tags. There are no separate "entry types" at the data level. Instead, reserved tags distinguish entries visually: `#observation` for observations made outside check-ins, `#feedback` for feedback from others (with the source person as free text in the note body), `#task` for open action items, and `#resolvedtask` for completed tasks. Entries without any reserved tag are implicitly check-in notes. Each discussion point is entered individually with its own tag set, where multiple tags may apply to a single entry.

Approximately 10 discussion points are captured per check-in session, with 20 sessions per team member per year, yielding roughly 3,000 structured entries annually plus ad-hoc observations and feedback. Entries are grouped by day in the history view rather than by explicit sessions.

Each entry supports **multi-tag classification** across predefined aspects: career, soft skills, technical capabilities, network, training, objectives and goals, and observations. Tags are entered via a `#` trigger in the note field. When a tag is typed followed by a space, it is automatically extracted from the note text and moved to a separate tag field where it appears as a removable chip with an X button. A dropdown suggests previously used tags during typing, and new tags can be created on the fly. Not every aspect is covered in every check-in — coverage varies by session.

A **preparation area** per team member defaults to a rendered markdown view for easy reading. Clicking the edit button (✎) switches to a textarea for editing; pressing Enter saves and returns to view mode (Shift+Enter for newlines). Alongside it, a **tag recency view** lists all tags and shows when each was last discussed, helping the team lead identify neglected topics.

A **tag overview page** lists all tags with their last-used date, sorted most recent first, providing a global view of tag activity across all team members.

**Task management** uses the tag system. Entries tagged with `#task` or `#followup` appear in a dedicated Open Tasks section. Each task has a state workflow with seven states: open, in-progress, check, on-hold, purgatory, resolved (done), and obsolete. State changes are made via a click-to-open dropdown on the state label. Tasks also support priority levels (high, medium, low) shown as colored dots, due dates, and an age indicator showing days since creation. An action button (⚡) opens a modal to append dated action lines to the entry. Resolved and obsolete tasks are hidden from task lists but remain in history with reduced opacity, showing only the first sentence with an expand triangle for full text. Followups share the same state and priority system.

**Goal management** is a first-class feature. Goals have varying end dates and are not versioned, but every entry related to a goal is automatically linked to it via unique goal tags, building a historical trail. Goals support priority levels, due dates, and can be marked as achieved or canceled. An action button (⚡) allows appending dated action lines. An edit button scrolls to the goal entry in history and opens edit mode. A cross-discussion All Goals view shows open goals across all discussions with filtering.

**Image support** allows pasting one image per entry from the clipboard using `Ctrl+V`. Images are converted to JPEG format and saved in a subfolder named after the team member, with filenames in `yyyy-mm-dd hh-mm-ss.jpg` format. The entry text contains a markdown image reference that renders inline in the history view.

The **user interface** uses a split view layout. The left sidebar contains discussion navigation grouped by discussion tags, with filter buttons and a recent bar. The center column contains the preparation area, entry input with tag chips, and the scrollable history grouped by day. The right column contains open tasks with state/priority controls, goals with action/edit/achieved/canceled buttons, a gallery, and the tag recency view. Both center and right columns scroll independently.

Eleven **cross-discussion views** are accessible from sidebar navigation buttons: Tags (tag overview with staleness coloring), Comments (all comments), Tasks (all open tasks as list), Kanban (drag-and-drop board by state), Goals (all open goals), Images (all images), Links (all links aggregated from entries and prep notes with inline title editing), **Names (registered `@[Name]` references with mention counts, last-seen dates, and per-name drill-down)**, Ro3 (Rule of Three — randomly selects 3 open tasks, one per priority level, with discussion tag filtering), Activity (dashboard with pie charts for entry types, task states, and goal states, plus a monthly timeline chart), and AI Summary (consolidates a discussion history via a configurable LLM endpoint). Each list view exposes a single search box that accepts `#tag` to filter by entry tag, `@Name` or `@[Full Name]` to filter by name reference, and any remaining text as freetext substring match.

**Discussion management** includes renaming, discussion tag assignment, and archiving (renames `.md` to `.archive.md`).

All interactive elements have **tooltips** (title attributes) for discoverability. Action icons use a consistent 18×18px bordered-box style with distinct colors: blue (edit), yellow (action), orange (move), red (delete).

The **user experience** prioritizes speed and keyboard-driven interaction. Upon entering a team member's view, focus is immediately placed on the input area, ready for writing. The workflow is topic-first: the user starts with a topic or tag, then writes the note, which naturally links the entry to the relevant aspect or goal.

A **dedicated cross-member topic view** provides a historical overview of a specific topic or tag across all team members. This is valuable because multiple team members often collaborate on the same initiatives, and the team lead needs to see how a topic has evolved across different people over time.

**Contribution summary exports** are generated in Markdown format, consolidating tagged entries into a structured document suitable for copy-pasting into the HR portal during mid-year and end-year review cycles. The **AI Summary** screen complements this for narrative summaries: it sends a discussion's history to a user-configured LLM endpoint and renders the response through the same chip-aware sanitization pipeline used elsewhere.

The application runs as a **local web page** opened directly in Chrome or Edge. Data is stored as **individual `.md` files per team member** in a local folder (`C:\Temp\Chippy\PeopleFiles`), using the File System Access API for reading and writing. Images are stored in member-named subfolders alongside the `.md` files. Data retention is at least 6 months beyond the end of each calendar year. No external integrations, cloud sync, or mobile access are required. The tool is entirely private.

Technology choices prioritize **stability over novelty**. The application is built with vanilla HTML, CSS, and JavaScript — no frameworks, no build step, no server required. One small third-party dependency: Cure53's DOMPurify (vendored at `local/lib/dompurify.min.js`), used at the HTML-rendering boundary to sanitize every `innerHTML` assignment with a tight tag/attribute/URI allowlist.

## Requirements List

Topics where a technical solution can make a difference.

| #  | Requirement                        | Description                                                                                          |
|----|------------------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Real-time note entry               | Topic-first workflow with auto-focus on team member selection, each discussion point entered individually |
| 2  | Unified entry model                | All entries share the same structure; `#observation`, `#feedback`, `#task`, `#resolvedtask` are reserved tags with distinct visual treatment |
| 3  | Multi-tag system                   | Inline `#` trigger; tag auto-extracted from note text on space into a separate tag field; dropdown auto-suggestion from predefined/used tags; on-the-fly tag creation; tags displayed as removable chips with X |
| 4  | Automatic goal linking             | Entries related to a goal are historically linked without manual association                          |
| 5  | Split view layout                  | Center: preparation, entry input, history. Right: tasks, goals, aspect recency. Independent scrolling |
| 6  | Unified discussion history         | Per team member, all entries with distinct visual markers for reserved tags; grouped by day           |
| 7  | Preparation area                   | Per-member text box to gather discussion points for the next check-in                                |
| 8  | Aspect recency view                | Per-member list of all aspects/tags showing when each was last discussed                             |
| 9  | Tag overview page                  | Global list of all tags with last-used date, sorted most recent first                                |
| 10 | Cross-member topic view            | Dedicated page showing historical entries for a tag/topic across all members                         |
| 11 | Task management                    | `#task` tag for open tasks shown in dedicated section; Resolve button changes to `#resolvedtask`     |
| 12 | Image paste support                | One image per entry via `Ctrl+V`; converted to JPEG; saved in member subfolder as `yyyy-mm-dd hh-mm-ss.jpg`; rendered inline in history |
| 13 | Markdown contribution summary      | Consolidated per team member for mid/end-year reviews                                                |
| 14 | Timestamps                         | Every entry carries a timestamp                                                                      |
| 15 | Feedback source                    | Free-text source person captured within the note body for `#feedback` entries                        |
| 16 | Local .md file storage             | Individual `.md` file per team member in `C:\Temp\Chippy\PeopleFiles`; File System Access API    |
| 17 | Image storage                      | Member-named subfolders alongside `.md` files; JPEG format; datetime filenames                       |
| 18 | Data retention                     | Minimum 6 months beyond calendar year end                                                            |
| 19 | Default data folder                | App displays `C:\Temp\Chippy\PeopleFiles` as the expected folder location                        |
| 20 | Task state workflow                | Seven states (open, inprogress, check, onhold, purgatory, resolved, obsolete) with click-to-change dropdown |
| 21 | Priority system                   | Three levels (high, medium, low) as colored dots; click to cycle                                     |
| 22 | Kanban board                      | Drag-and-drop board view for tasks/followups organized by state columns                              |
| 23 | Action modal                      | Append dated action lines to tasks, followups, and goals via a styled modal                          |
| 24 | Archive discussions                | Rename `.md` to `.archive.md`, remove from navigation                                                |
| 25 | Preparation markdown view         | Preparation area defaults to rendered markdown; edit button toggles to textarea; Enter saves         |
| 26 | Tooltips                          | Title attributes on all interactive elements for discoverability                                     |
| 27 | Followup entries                  | `#followup` tag for follow-up items sharing task state and priority system                           |
| 28 | Due dates                         | Date picker on tasks and goals; calendar icon to set, inline input to change                         |
| 29 | Move comments                     | Move an entry from one discussion to another via dropdown                                            |
| 30 | All Links view                    | Cross-discussion link aggregation from entries and prep notes, deduplicated by URL                   |
| 31 | Per-discussion links panel        | Links section in right panel showing all links extracted from the current discussion                 |
| 32 | Slim mode                         | Responsive layout for viewports under 800px with tab-based navigation (Nav/Notes/Tasks)             |
| 33 | Activity dashboard                | Pie charts for entry types, task states, goal states; monthly timeline chart for comments, tasks, links, images |
| 34 | Markdown in task/goal lists        | Task and goal text rendered as markdown in right panel, All Tasks, All Goals, and Kanban views       |
| 35 | Filter UX improvements            | Clear (×) buttons on all filter/search inputs; "All" button in sidebar tag filters; orange highlight on active filters |
| 36 | Image transfer on move            | Images transferred to target discussion folder when moving a comment between discussions             |
| 37 | Cumulative activity charts        | Area chart showing total entries over time; stacked bar chart showing open task balance (OPEN/WIP/CHK above zero, HOLD/PRGT below) |
| 38 | Dashboard code separation         | Dashboard rendering extracted to `dashboard.js` for maintainability                                  |
| 39 | Goals styling consistency         | Goals use plain text style matching tasks; multi-line goals show first line with expand indicator     |
| 40 | Double-click navigation           | Double-click on task or goal text in right panel jumps to the comment in discussion history           |
| 41 | Edit timestamp threshold          | "Updated:" timestamp only appended when editing a comment on a different calendar day than creation   |
| 42 | Sidebar discussion search         | Search text field above discussion list filters discussions by name as you type                       |
| 43 | Sidebar search clear button       | Clear (×) button on sidebar search input to reset the filter                                         |
| 44 | Inline link title editing         | Pencil icon on link list items opens an inline input to rename the link's display title in the source entry |
| 45 | Kanban image icon                 | Camera icon shown on kanban cards when the task entry contains a pasted image                         |
| 46 | List rendering consistency        | Bullet and numbered lists render correctly across all views (tasks, kanban, history) with inside positioning and hanging indent |
| 47 | Rule of Three (Ro3)               | Cross-discussion page that randomly selects 3 open tasks (1 high, 1 medium, 1 low priority), with refresh and discussion tag filtering |
| 48 | Cache-busting version params      | Query string version parameters on CSS and JS links to force browser cache refresh after updates      |
| 49 | Help dialog page descriptions     | Help dialog lists all 11 cross-discussion pages with individual descriptions, plus documentation for image icon, double-click navigation, and edit timestamp behavior |
| 50 | Light/dark theme toggle           | Sun/moon button in the top chrome; persists in `navigation.md` and `localStorage` for first-paint; all colors driven through CSS variables (added v2.13) |
| 51 | AI Summary screen                 | Configurable LLM endpoint per data folder; conversation streams into a sanitized markdown view; settings stored in `summary.md` (added v2.11) |
| 52 | Reload from disk button           | ↻ icon next to the discussion title force-reloads the discussion file, catching external edits without losing browser state (added v2.12) |
| 53 | Auto-save entry drafts            | Comments-in-progress persist to `localStorage` with 300ms debounce; restored silently on discussion re-open; orphan drafts cleaned up at folder load (added v2.16–v2.17) |
| 54 | Named-person references           | `@[First Last]` syntax inside entries renders as colored text (Vert Véronèse / Weltos Grün) using a global names registry in `navigation.md`. Click navigates to All Names. `@` after whitespace opens an autocomplete dropdown in both the entry textarea and the seven list-view search boxes (added v2.31, v2.34, v2.36) |
| 55 | All Names cross-discussion view   | New sidebar page listing every registered name with total mention count, last-seen date, and the discussions it appears in. Rows expandable to show recent mention excerpts (added v2.31) |
| 56 | Top chrome bar                    | Persistent 36px bar across the viewport carrying app title, recent-discussion tabs, theme toggle, help, and a context-aware print button that adapts its target to the active screen (added v2.21–v2.30) |
| 57 | Unified search syntax             | Single search box per list view parses `#tag` tokens as entry-tag filters, `@Name` / `@[Full Name]` tokens as name filters, and the remainder as freetext substring search. Auto-complete dropdowns fire on `@` and `#` (added v2.33–v2.34) |
| 58 | XSS hardening                     | DOMPurify wraps every `.innerHTML =` assignment via a shared `safeSetHtml()` helper; image paths are validated with `isSafeImagePath()` rejecting `..`, leading separators, drive letters, and URL schemes; URL scheme allowlist restricts link `href` to `http(s):`, `mailto:`, and relative paths (added v2.35–v2.36) |
| 59 | Print preview consolidation       | One print button lives in the top chrome and routes to the right `print*()` handler based on the active screen (discussion, all comments, all tasks, all goals, all images, all links, all names); hidden on kanban, Ro3, dashboard, summary (added v2.30) |

## Action List

Topics or aspects where a technical solution is not feasible.

| #  | Item                              | Description                                                                                          |
|----|-----------------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Quality of observations           | Richness depends on the team lead's discipline in recording promptly after interactions               |
| 2  | Feedback solicitation             | The tool stores feedback but cannot automate requesting it from colleagues                           |
| 3  | Narrative quality of summaries    | Markdown export provides structure, but the final HR narrative requires human judgment                |
| 4  | Goal definition quality           | The tool tracks progress but cannot assess goal quality or alignment                                 |

## Questions & Answers

### Gate 1 — Product Manager

| #  | Question                                                                 | Answer                                                                                               |
|----|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Who is the primary user?                                                 | Team lead, tracking discussions with individual team members                                         |
| 2  | Current check-in format?                                                 | Informal bi-weekly, notes in Trello card comments. Doesn't scale with complexity                     |
| 3  | What aspects are tracked?                                                | Career, soft skills, technical capabilities, network, training, objectives & goals, observations      |
| 4  | How are summaries produced today?                                        | Manual review of comments, formalized into assessment. Observations frequently lost                  |

### Gate 1 — Business Analyst

| #  | Question                                                                 | Answer                                                                                               |
|----|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 5  | Stakeholders beyond team lead?                                           | Only team lead and respective team member. Fully private                                             |
| 6  | Current tools and integration needs?                                     | Trello currently. Summaries copy-pasted to HR portal. No integration needed                          |
| 7  | Examples of tracked decisions?                                           | Agree to take training, commit to finalize by a date                                                 |
| 8  | How is goal progress managed?                                            | Various end dates, discussion points can't currently auto-link to goals                              |

### Gate 2 — Data Architect

| #  | Question                                                                 | Answer                                                                                               |
|----|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Data volume?                                                             | 15 members, ~10 points/check-in, ~20 check-ins/person/year + observations                           |
| 2  | Multi-tagging support?                                                   | Yes, with predefined tags readily available                                                          |
| 3  | Goal versioning needed?                                                  | Not needed, but notes should auto-link to goals historically                                         |
| 4  | Retention period?                                                        | At least 6 months beyond end of year                                                                 |

### Gate 2 — UX Designer

| #  | Question                                                                 | Answer                                                                                               |
|----|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 5  | Workflow during live check-in?                                           | Real-time notes, topic-first entry to link aspects                                                   |
| 6  | Navigation between team members?                                         | Quick-switch via shortcut + type name, auto-focus on write                                           |
| 7  | Export format?                                                           | CSV for data, Markdown for contribution summaries                                                    |
| 8  | Mobile access needed?                                                    | Not required                                                                                         |

### Gate 3 — Requirements Engineer

| #  | Question                                                                 | Answer                                                                                               |
|----|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Concurrent check-in sessions?                                            | No, one at a time                                                                                    |
| 2  | What happens with unlinked discussion points?                            | Register a new tag and link to that                                                                  |
| 3  | CSV export granularity?                                                  | One row per discussion point, tags for filtering                                                     |
| 4  | Observations vs check-in notes?                                          | Same structure, grouped by day; `#observation` and `#feedback` as reserved tags with distinct visual treatment |

### Gate 3 — Systems Architect

| #  | Question                                                                 | Answer                                                                                               |
|----|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 5  | Deployment model?                                                        | Local web page opened in Chrome/Edge; also available as Docker container                             |
| 6  | Tech stack preference?                                                   | Vanilla HTML/CSS/JS, no frameworks, stability first                                                  |
| 7  | Data storage?                                                            | Individual `.md` files per team member (local version); SQLite (container version)                    |
| 8  | Cross-member search?                                                     | Yes, historic overview per topic across members                                                      |

### Gate 4 — SW Engineer

| #  | Question                                                                 | Answer                                                                                               |
|----|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Frontend framework?                                                      | No preference, stability first — vanilla JS chosen                                                   |
| 2  | Backend framework?                                                       | None for local version; Flask for container version                                                   |
| 3  | Quick-switch interaction?                                                | Ctrl+K keyboard shortcut                                                                             |
| 4  | Tag input method?                                                        | Inline `#` trigger; tag auto-extracted from note on space into separate tag field as removable chips  |
| 5  | Cross-member view?                                                       | Dedicated menu/page                                                                                  |
| 6  | Export format?                                                           | Markdown for contribution summaries                                                                  |

### Confidence Refinement — Follow-up Q&A

| #  | Agent                  | Question                                                                 | Answer                                                                                               |
|----|------------------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Business Analyst       | Are all aspects covered in every check-in, or a subset with rotation?    | Not every aspect is covered in every check-in. A preparation area and aspect recency view were added. |
| 2  | Data Architect         | Should observations have a different structure than check-in notes?       | Same structure, grouped by day. `#observation` and `#feedback` are reserved tags, not separate types. |
| 3  | UX Designer            | Should tag text stay inline or move to a separate field?                  | Tag auto-extracted from note text on space into a separate tag field; displayed as chips with X.      |
| 4  | Requirements Engineer  | Is tag management (rename/merge/delete) needed?                          | A tag overview page with last-used dates, sorted most recent first. Append-only with visibility.     |
| 5  | Systems Architect      | Can we settle on SQLite as the single storage backend?                   | SQLite for container version; `.md` files per member for local version.                              |
| 6  | SW Engineer            | Feedback source — free text or managed list?                             | Free text within the note body. All entries are unified; `#feedback` is a reserved tag.              |
| 7  | SW Engineer            | Should check-in sessions be a grouping concept?                          | No explicit sessions. Entries are individual, grouped by day in the history view.                     |

### Post-Refinement Feature Additions

| #  | Feature                | Description                                                                                          |
|----|------------------------|------------------------------------------------------------------------------------------------------|
| 1  | Task management        | `#task` reserved tag with dedicated Open Tasks section and Resolve button changing to `#resolvedtask` |
| 2  | Tag auto-extract       | Typing `#tagname` followed by space removes the tag from text and adds it as a chip                  |
| 3  | Image paste            | `Ctrl+V` pastes one image per entry; saved as JPEG in member subfolder with `yyyy-mm-dd hh-mm-ss.jpg` filename |
| 4  | Split view layout      | Center: prep area, entry input, history. Right panel: tasks, goals, aspect recency                   |
| 5  | Default folder path    | App displays `C:\Temp\Chippy\PeopleFiles` as the expected data folder                            |
| 6  | Local .md storage      | Alternative to SQLite; individual `.md` file per member using File System Access API                 |

## Data Format

The full, authoritative on-disk data format lives in a dedicated document,
[`datadefinition.md`](datadefinition.md): discussion files, the split index files
(`navigation.md`, `tags.md`, `names.md`), `summary.md`, the reserved-tag vocabulary and task/goal
state model, the comment-write rules, and the image/folder layout.

This section previously inlined an earlier copy of that spec. It has been consolidated into
`datadefinition.md` to remove duplication and to reflect the current split-index layout — the tag
union and the names list now live in `tags.md` / `names.md` rather than inline in `navigation.md`.

## Gate Confidence Summary

### Initial Assessment

| Gate | Agents                                          | Avg Confidence | Result |
|------|-------------------------------------------------|----------------|--------|
| 1    | Product Manager (80%), Business Analyst (75%)   | 77.5%          | Pass   |
| 2    | Data Architect (82%), UX Designer (78%)         | 80%            | Pass   |
| 3    | Requirements Engineer (80%), Systems Architect (78%) | 79%       | Pass   |
| 4    | SW Engineer (80%)                               | 80%            | Pass   |

### After Refinement

| Gate | Agents                                               | Avg Confidence | Result | Delta  |
|------|------------------------------------------------------|----------------|--------|--------|
| 1    | Product Manager (85%), Business Analyst (85%)        | 85%            | Pass   | +7.5   |
| 2    | Data Architect (90%), UX Designer (88%)              | 89%            | Pass   | +9     |
| 3    | Requirements Engineer (88%), Systems Architect (90%) | 89%            | Pass   | +10    |
| 4    | SW Engineer (88%)                                    | 88%            | Pass   | +8     |
