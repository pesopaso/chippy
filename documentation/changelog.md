# Chippy — Changelog

Version history of implementation changes for the chippy rewrite. This file is the
single reference for the current and future version history; add an entry whenever a
piece of implementation work lands.

The MVP-era history (v0.1–v2.42) was retired when the rewrite began and is no longer
tracked. This changelog starts fresh and follows the
[implementation plan](implementation-plan.md), step by step.

## Format

One entry per change, newest at the top:

```
### vX.Y — YYYY-MM-DD — short title

> One-line summary of what changed and why.

- Specific change.
- Specific change.
```

- Bump the minor version (`vX.Y`) per shipped change; reserve major bumps for milestones.
- When a change touches `format.js` or `io.js`, note that the regression harness
  (`regressionharness/roundtrip.test.mjs`) was run and stayed green.
- Reference the requirement (`R#`) and/or implementation-plan step the change satisfies.

## Unreleased

### v3.0.0-dev.3 — 2026-05-31 — Classic scripts; runs from file://

> App wiring moved from ES modules to classic scripts on a global `Chippy` namespace, so it loads
> directly from a `file://` page with no server (Chrome blocks cross-file `import` under `file://`).

- All flat scripts rewrapped as IIFEs attaching to `window.Chippy.*` — no `import`/`export`.
- `app.html` loads them via ordered `<script>` tags (`format → io → store → ui → discussion → pages → dashboard → main`); removed `type="module"`.
- Harness `adapter.mjs` now loads `format.js` for side-effect and reads `globalThis.Chippy.format`; round-trip stays **7/7** byte-for-byte.
- Docs updated (target-architecture, implementation-plan Step 1, `src/local` README); `serve.cmd` / localhost now optional rather than required.

### v3.0.0-dev.2 — 2026-05-31 — Open Folder control

> A sidebar Open Folder button wired to the persistence layer so a data folder can be connected and verified.

- `#btnOpenFolder` + status line; opens the folder, loads the indexes, lists discussions, stashes the handle on `Chippy.dir`.

### v3.0.0-dev.1 — 2026-05-31 — Scaffold, format & persistence layers (Steps 1–3)

> The app shell plus the persistence layer.

- **Step 1** — `app.html` shell (36px top chrome, theme toggle, welcome), `style.css` full dark/light CSS-variable palette, module stubs, SPDX headers, `THIRD-PARTY-NOTICES`, DOMPurify placeholder (real binary still to be dropped in).
- **Step 2** — `format.js` pure parse/serialize for discussion / navigation / tags / names / summary + legacy migration; regression harness wired (`IMPLEMENTED = true`), **7/7** byte-for-byte.
- **Step 3** — `io.js` File System Access wrappers (open/list/load/save/rename/archive), split-index read/write with one-time legacy migration, and `ImageStore` behind `isSafeImagePath`; path guards **17/17**.
