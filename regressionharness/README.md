# Regression harness — notebook data format

A round-trip harness for the notebook Markdown data format, run over realistic reference data. It
is the **contract for the format layer**: parsing a file and serializing it back must produce
exactly the original bytes, so any change to chippy's format layer that loses fidelity fails loudly.

**Clean-room — no copied implementation.** This harness contains no parser or serializer. It is
reference data + a runner + an adapter seam. chippy's format layer is written from scratch; once it
exists, wire `adapter.mjs` to it. Until then the runner reports PENDING.

## Run

```
node roundtrip.test.mjs
```

Pure Node (ESM), no dependencies. Exit codes: 0 = all pass, 1 = at least one failure (with a
byte-level diff at the first mismatch), 2 = PENDING (adapter not yet wired).

## What it contains

```
regressionharness/
├── adapter.mjs               # seam to chippy's own format layer — wire it, set IMPLEMENTED = true
├── roundtrip.test.mjs        # the test runner
└── referencedata/            # canonical files — each must round-trip byte-for-byte
    ├── navigation.md          # split index: discussions + theme
    ├── tags.md                # split index: the tag union
    ├── names.md               # split index: known names
    ├── 1-1 Maria Lopez.md      # people check-in
    ├── 1-1 James Okafor.md     # people check-in
    ├── Cloud Migration.md      # enterprise project (links, names, images)
    ├── Cloud Migration/        # its images (architecture, staging)
    ├── SOC 2 Compliance.md     # enterprise initiative (links, names, image)
    └── SOC 2 Compliance/       # its image (access-review dashboard)
```

`adapter.mjs` exports the functions the runner needs — `parseDiscussion`/`serializeDiscussion`,
`parseNav`/`serializeNav`, `parseTags`/`serializeTags`, `parseNames`/`serializeNames` — plus an
`IMPLEMENTED` flag. They are unimplemented stubs until you wire them to chippy's from-scratch
`format.js` and flip the flag. The reference data here and the spec in
`../documentation/datadefinition.md` are the contract those functions must satisfy. Nothing is
ported from the MVP — the rewrite is from scratch.

## The reference data

Four discussions on four typical enterprise topics; two are written as recurring people check-ins
(`1-1 Maria Lopez`, `1-1 James Okafor`) and two as initiatives (`Cloud Migration`,
`SOC 2 Compliance`). Each discussion has several comments plus three tasks and two goals. Together
they exercise every format feature at least once:

- **All seven task states** — OPEN, WIP, CHK, HOLD, PRGT, DONE, OBSL (spread across the four files).
- **Both followup states** — open and `resolvedfollowup` (James Okafor).
- **All three goal states** — open, Archived (`achievedgoal`), Canceled (`canceledgoal`).
- **Priorities** `high`/`medium`/`low`, **due dates**, and **goal linking** (the `goal-<id>` tag
  plus the `goal:` header field — Maria Lopez).
- **Lifecycle markers** — `Resolved`, `Obsolete`, `Achieved`, `Canceled` — and **resolution-action**
  blocks.
- **Embedded forms** — `@[Name]` references, URLs as Markdown links, inline image references, and a
  `muted:<date>` marker (SOC 2 Compliance). The two enterprise discussions carry named owners/
  auditors (`@[Priya Nair]`, `@[Marcus Chen]`, `@[Dana Whitfield]`, `@[Raj Patel]`), links to
  charters/ADRs/policies, and themed images stored in their per-discussion subfolders.

The three split index files round-trip too: `navigation.md` (the `> theme:` line and discussions
with `tag`/`favorite`/`archived` flags), `tags.md` (the de-duped, sorted tag union — including the
`goal-<id>` tags and the `muted:` marker), and `names.md` (the de-duped, sorted names list).

## The assertion

For every `.md` in `referencedata/`, `serialize(parse(file)) === file`, byte-for-byte. Routing by
filename: `navigation.md` → nav functions, `tags.md` → tags functions, `names.md` → names
functions, every other `.md` → discussion functions. The files are authored in canonical
serialized form, so the identity must hold exactly. (Image subfolders hold `.jpg` files and are
not part of the round-trip; only the `.md` references to them are.)

## Note on canonical form

The format layer is only guaranteed to round-trip files that are already canonical. When chippy's
`format.js` reads a non-canonical file (out-of-order entries, empty entries, stray whitespace,
legacy metadata or `## Goals` sections), it normalizes on write — those normalizations are
documented in `../documentation/datadefinition.md`. The reference files are kept canonical so the
identity test stays exact.
