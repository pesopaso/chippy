# Chippy

A local, single-user web tool for staying on top of long-running discussions — bi-weekly 1:1s,
recurring meeting series, ongoing projects, research threads, or any topic that evolves over time.
It captures timestamped, multi-tagged entries, auto-links them to goals, tracks tasks and
follow-ups through a seven-state workflow, and turns scattered notes into structured summaries.

Everything stays on your machine: data is stored as plain Markdown files in a folder you choose,
read and written directly through the browser's File System Access API. No server, no build step,
no cloud, no accounts.

## Highlights

- **Unified entry model** — every note is a timestamped, multi-tagged entry; reserved tags drive
  behavior (`#task`, `#followup`, `#goal`, priorities, and states).
- **Tasks & goals** — seven-state task workflow (OPEN / WIP / CHK / HOLD / PRGT / DONE / OBSL),
  priorities, due dates, a Kanban board, and a Rule-of-Three focus page.
- **Cross-discussion views** — Tags, Comments, Tasks, Goals, Images, Links, Names, Kanban, Ro3,
  an Activity dashboard, and an AI Summary screen.
- **Authoring** — markdown rendering, clipboard image paste, `@[Name]` references, auto-linked
  URLs, a unified `#tag` / `@name` / freetext search, and silent draft autosave.
- **Safe by default** — all rendered HTML passes through DOMPurify; image paths are guarded
  against traversal.
- Light and dark themes, plus a responsive slim mode for narrow viewports.

## Tech

Vanilla HTML, CSS, and JavaScript (ES modules) — no framework, no build step, no server. Opens
directly in Chrome or Edge. One vendored dependency: Cure53's DOMPurify, at the HTML-render
boundary.

## Data

Plain Markdown in a single local folder: one file per discussion, plus split index files
(`navigation.md`, `tags.md`, `names.md`) and an optional `summary.md`. The authoritative format
spec is [`documentation/datadefinition.md`](documentation/datadefinition.md), pinned byte-for-byte
by the [regression harness](regressionharness/README.md).

## Project layout

- `src/local/` — the local app (flat ES module scripts).
- `documentation/` — product spec, target architecture, implementation plan, data definition,
  changelog, and color reference.
- `regressionharness/` — round-trip tests that pin the on-disk data format.

## Status

Clean re-implementation in progress. The product spec and architecture are settled; code is built
step by step per the [implementation plan](documentation/implementation-plan.md). `src/local/` is
currently a scaffold.

## License

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Copyright 2026 Philipp Sommer.
