# JetBrains Mono — analysis and decision

**Status: DEFERRED** (analyzed 2026-09-17, decision 2026-09-18 — not implemented for now)

An assessment of introducing the [JetBrains Mono](https://www.jetbrains.com/lp/mono/)
typeface into Chippy, kept here so the ground work is not lost if the idea is picked up
again.

---

## Where Chippy stands

- The whole UI runs on `Roboto, -apple-system, … sans-serif` (`style.css`); Roboto is
  referenced, not bundled — it falls back to system fonts (see `THIRD-PARTY-NOTICES.md`).
- Monospace appears in exactly one gap: `code` / `pre` blocks in comment markdown and the
  help dialog's code chips get styled boxes but **no explicit font-family on screen** —
  they inherit the browser's default mono. Only the print stylesheet sets a proper
  `ui-monospace, SFMono-Regular, Menlo, Consolas, …` stack.

## Licensing — no obstacle

JetBrains Mono is **SIL Open Font License 1.1**: free for commercial use, explicitly fine
to bundle in applications, redistributable. Obligations fit the existing pattern: ship the
OFL license text alongside the font files and add an entry to `THIRD-PARTY-NOTICES.md`.
Compatible with the project's Apache-2.0 licensing. Eight weights + italics exist; the
practical set is Regular + Bold.

## The hard constraint: vendoring

Chippy runs from `file://` with no CDN, so a Google-Fonts-style `<link>` is out. The font
must be **vendored** as woff2 files with `@font-face` and relative URLs (same pattern as
`dompurify.min.js`, cache-busted with `?v=`). Cost ≈ 100–130 KB per weight (~250 KB for
Regular + Bold) — more than doubles the app payload, irrelevant for a local app. Use
`font-display: swap` and keep the `ui-monospace, Consolas, …` fallback stack so nothing
breaks if the files go missing. Download source that works from the sandbox:
`raw.githubusercontent.com/JetBrains/JetBrainsMono/<tag>/fonts/webfonts/…` (the npm/cdnjs
routes are blocked by the egress allowlist).

## Scope options

1. **Code and pre blocks only** *(recommended if revived)* — fills the actual gap, zero
   layout risk. One `@font-face` pair, one CSS rule.
2. **Plus "data" tokens** — timestamps, due dates, version stamp: mono digits are tabular,
   so times/dates align vertically in the stream and lists. Mono runs ~10–15% wider;
   easily absorbed.
3. **Whole-UI replacement — advised against.** JetBrains Mono is designed for code
   scanning, not prose; comments and preparation notes read slower and take more
   horizontal space, stressing the sidebar (206px), kanban cards and calendar columns.

## Technicalities noted for later

- **Ligatures** (`->` rendered as an arrow, etc.) are on by default in browsers; for
  literal display in pasted snippets, `font-feature-settings: "liga" 0` turns them off.
- The **print stylesheet** should name JetBrains Mono first in its code stack so print
  matches screen.
- A **variable font** file (`JetBrainsMono[wght].woff2`) covers all weights in one file
  (~120 KB) but needs a second file for italics; static Regular + Bold is simpler.

## Implementation sketch (when revived)

`src/local/fonts/` with `JetBrainsMono-Regular.woff2`, `JetBrainsMono-Bold.woff2` and
`OFL.txt`; `@font-face` rules at the top of `style.css`; `code, pre { font-family:
'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New',
monospace; }` (+ the chosen data-token selectors); print stack updated;
`THIRD-PARTY-NOTICES.md` entry; changelog + version stamp; headless before/after
screenshot as verification.
