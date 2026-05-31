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

_No entries yet — the first entry lands with Step 1 of the implementation plan._
