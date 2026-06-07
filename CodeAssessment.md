# Chippy — Code Assessment

**Date:** 2026-06-07
**Revision analysed:** `c65e458` (branch `staging`)
**Scope:** the application source in `src/local/` (8 hand-authored JavaScript modules). The vendored `dompurify.min.js` and the test/regression harness are excluded from the quality metrics but noted where relevant.

> **Methodology note.** The analysis sandbox served truncated copies of several working-tree files, so all quantitative metrics below were computed against the complete, self-consistent **committed `HEAD`** sources extracted directly from the git object store. There are uncommitted working-tree edits (per `git status`); the figures here describe the committed revision. Re-run the toolchain on the working tree before acting on file/line references if those edits are substantial.

Tooling used: `jscpd` (duplication), ESLint v10 with a custom flat config (style, bad practices, dead code, cyclomatic complexity), and a custom `espree`-based AST walker (LOC, function counts, Halstead volume, cyclomatic complexity, Microsoft Maintainability Index).

---

## 1. Executive summary

Chippy is a deliberately build-free, dependency-free browser app: eight classic-script IIFE modules that each attach an API to a shared `window.Chippy` namespace. For a codebase of this style it is in **good shape**. Style discipline is high (no `var`, strict equality throughout, consistent quoting, indentation, and semicolons, zero `TODO`/`FIXME` debt markers), duplication is low (1.33%), and the average function is small and simple (≈85% of functions have cyclomatic complexity ≤ 5).

The weaknesses are concentrated rather than systemic. A handful of "god functions" — chiefly `ui.js::entryCard` (CC 45) and a large subscribe-callback in `main.js` (CC 41) — carry most of the complexity. Task-state classification logic is reimplemented in four modules. There is a small amount of genuine dead code and two committed `.bak` files. The maintainability index is healthy everywhere (all modules ≥ 34 on the 0–100 Microsoft scale, threshold 20), with `main.js` and `ui.js` the relative laggards.

| Health indicator | Result | Verdict |
|---|---|---|
| Style consistency | Very high | ✅ |
| Code duplication | 1.33% literal | ✅ |
| Dead code | ~5 symbols + 2 `.bak` files | 🟡 minor |
| Cyclomatic complexity | 23 functions over 10; 2 severe | 🟡 concentrated |
| Maintainability index | Project 51.4 (all modules ≥ 34) | ✅ |
| Bad practices | NUL-byte sentinels, god functions, cross-module duplication | 🟡 |

---

## 2. Lines of code

Measured on the eight committed application modules (vendored DOMPurify excluded).

| File | Code | Comment | Blank | Total |
|---|---:|---:|---:|---:|
| store.js | 595 | 80 | 86 | 761 |
| discussion.js | 541 | 47 | 55 | 643 |
| pages.js | 508 | 32 | 47 | 587 |
| ui.js | 416 | 64 | 47 | 527 |
| main.js | 342 | 32 | 41 | 415 |
| dashboard.js | 302 | 20 | 19 | 341 |
| io.js | 200 | 24 | 37 | 261 |
| format.js | 197 | 17 | 32 | 246 |
| **Total** | **3,101** | **316** | **364** | **3,781** |

Comment ratio is 9.2% (code:comment ≈ 9.8:1). Most comments are high-value file/section headers and architectural notes rather than line noise. For reference, the separate test/regression harness adds ~2,187 lines of `.mjs` and the vendored `dompurify.min.js` is a single minified line.

---

## 3. Duplicated code

`jscpd` (min 50 tokens) reports **1.33% duplicated lines — 50 lines across 5 exact clones**. This is low and below the typical 3–5% concern threshold.

| Lines | Location A | Location B |
|---:|---|---|
| 16 | discussion.js L332 | pages.js L141 |
| 12 | discussion.js L507 | pages.js L241 |
| 10 | discussion.js L358 | pages.js L302 |
| 10 | dashboard.js L22 | ui.js L288 |
| 7 | discussion.js L351 | ui.js L279 |

**More important than the literal clones is the *semantic* duplication they point to.** The task/entry **state-classification logic** (`stateKeyOf` / `cardStateKey` / `entryType`) is independently implemented in **four modules — `dashboard.js`, `discussion.js`, `pages.js`, and `ui.js`** — and the `HIDDEN_TAG` reserved-tag regex constant is defined in **four files** (`discussion.js`, `pages.js`, `store.js`, `ui.js`). Token-based tools only catch the parts that happen to be textually identical; the real maintenance hazard is that the same business rule lives in several places and can drift out of sync.

---

## 4. Modules, classes and functions

**Architecture:** 8 application modules, each a single IIFE that registers a namespace on `window.Chippy` (`format`, `io`, `store`, `ui`, `pages`, `discussion`, `dashboard`, plus the `main` bootstrap). There are **no ES `class` declarations** — the design is module-scoped functions and closures throughout. Module boundaries are clean and layered (format → io → store → ui → views → main).

**Functions:** 556 function bodies excluding the 8 IIFE wrappers — **275 named/assigned functions and 281 anonymous callbacks** (mostly array/event/`map` callbacks).

| Module | Total fns | Named | Anon callbacks | Avg CC | Max CC |
|---|---:|---:|---:|---:|---:|
| store.js | 125 | 79 | 46 | 3.1 | 24 |
| pages.js | 114 | 41 | 73 | 3.6 | 25 |
| discussion.js | 104 | 40 | 64 | 3.2 | 36 |
| ui.js | 91 | 29 | 62 | 3.4 | 79\* |
| dashboard.js | 42 | 29 | 13 | 3.6 | 15 |
| main.js | 27 | 14 | 13 | 6.7 | 58\* |
| io.js | 27 | 26 | 1 | 2.3 | 13 |
| format.js | 26 | 17 | 9 | 3.6 | 18 |

\* The high Max-CC for `ui.js` and `main.js` reflects an inclusive count (decisions in nested callbacks roll up to the enclosing function). ESLint's per-function (exclusive) numbers in §6 are lower and are the figures to act on.

Average functions-per-module is sound and the average cyclomatic complexity per function is low (2.3–3.6) everywhere except `main.js` (6.7), which is dominated by one oversized callback.

---

## 5. Dead code

**Genuine unused symbols** (defined, never referenced):

| File | Symbol | Kind |
|---|---|---|
| discussion.js | `STATE_LABEL` | unused constant |
| discussion.js | `showMoveDialog` | unused function |
| discussion.js | `showDeleteDialog` | unused function |
| discussion.js | `entryKindClass` | unused function |
| pages.js | `HIDDEN_TAG` | unused constant (duplicated from other modules) |

**Dead files committed to the repo:** `src/local/io.js.bak` and `src/local/store.js.bak`. Editor backup files should not be version-controlled; delete them and add `*.bak` to `.gitignore`.

**Generated artifacts in the tree:** `test-results/` and `tests/local/.tmp/runs/**` contain many committed run-output `.md` files. If these are regenerated by the test suite they are noise in the repo and should be `.gitignore`d.

> The `catch (_) {}` throwaway parameters flagged by the linter are intentional and **not** dead code.

---

## 6. Cyclomatic complexity

**Distribution (556 functions):** 471 simple (CC 1–5, ~85%), 50 moderate (6–10), 27 high (11–20), 8 very high (21+). The codebase is overwhelmingly simple with complexity pooled in a few functions.

ESLint (per-function, threshold 10) flags **23 functions**. The notable offenders:

| CC | Function | Location |
|---:|---|---|
| 45 | `entryCard` | ui.js:323 |
| 41 | (subscribe render arrow) | main.js:328 |
| 22 | `addEntry` (async) | store.js:203 |
| 21 | `parseMd` | ui.js:89 |
| 18 | `parseDiscussion` | format.js:50 |
| 15 | `parseSummary` | format.js:189 |
| 15 | `renderTaskRow` | discussion.js:373 |
| 14 | `render` | discussion.js:562 |
| 13 | `renderHistory` | discussion.js:305 |
| 13 | `isSafeImagePath` | io.js:33 |
| 13 | `openSummary` (async) | pages.js:497 |
| 13 | `renderSidebar` | pages.js:67 |
| 12 | `getAllNames`, `getAllTags` | store.js:584, 612 |

`entryCard` (CC 45, 185 SLOC) and the `main.js` subscribe callback (CC 41) are the two that most warrant decomposition. The parser functions (`parseMd`, `parseDiscussion`, `parseSummary`) carry inherent branching but are pure and unit-tested, which lowers the risk.

---

## 7. Maintainability index

Microsoft 0–100 scale (≥ 20 maintainable, 10–19 marginal, < 10 poor), computed per module as the SLOC-weighted mean of its functions' MI (the outer IIFE wrapper excluded so it doesn't swamp the score).

| Module | MI | Band |
|---|---:|---|
| io.js | 63.1 | ✅ |
| store.js | 60.8 | ✅ |
| dashboard.js | 54.3 | ✅ |
| pages.js | 54.3 | ✅ |
| format.js | 53.8 | ✅ |
| discussion.js | 48.8 | ✅ |
| ui.js | 42.9 | ✅ |
| main.js | 34.0 | ✅ (weakest) |
| **Project (weighted)** | **51.4** | ✅ |

Every module clears the maintainable threshold comfortably. `main.js` and `ui.js` are the relative weak points — in both cases pulled down by a single large function rather than pervasive complexity, so targeted refactoring will move them up quickly.

---

## 8. Syntax, style and consistency

Style discipline is a clear strength. No syntax errors; all eight modules parse cleanly as ES (latest) classic scripts.

- **Declarations:** 0 uses of `var` — fully `const`/`let`. Three `let`s could be `const` (pages.js:417 `live`, ui.js:96 `line`, ui.js:431 `visible`).
- **Equality:** strict `===`/`!==` throughout; ESLint's `eqeqeq` found **zero** loose-equality issues.
- **Quoting:** single quotes dominate (1,127 vs 29 lines with double quotes) — consistent.
- **Termination & indentation:** semicolons used consistently; indentation is spaces only (2/4-space nesting), no tabs.
- **Debt markers:** zero `TODO`/`FIXME`/`HACK`/`XXX`.
- **Variable shadowing:** 2 instances (`refresh` at pages.js:455; `esc` at ui.js:194).
- **`no-undef`:** 6 reports for `CSS` and `Option` — these are legitimate browser globals (`CSS.escape`, the `Option` constructor) and are **false positives** of the lint config, not defects. Add them to the project's ESLint globals to silence.

Overall ESLint tally: **54 problems (6 errors, 48 warnings)** — the 6 "errors" are the `CSS`/`Option` false positives; the substantive warnings are the complexity, dead-code, `prefer-const`, and `no-shadow` items already itemised.

---

## 9. Bad practices and smells

1. **NUL-byte in-band sentinels.** `ui.js::parseMd` uses literal ` CODE… ` markers to protect code spans during markdown rendering (`io.js` similarly defines `NUL = String.fromCharCode(0)`). It works, but embedding NUL in source makes the file register as *binary* to `grep`/`diff` and is fragile if input ever contains the sentinel. Prefer a placeholder that cannot occur in user text (e.g. a private-use Unicode code point or an indexed token map).
2. **God functions.** `entryCard` (185 SLOC / CC 45) and the `main.js` subscribe callback (CC 41) concentrate too much responsibility; they are the hardest code to test and change safely.
3. **Cross-module logic duplication.** State classification in 4 modules and the `HIDDEN_TAG` regex in 4 modules (see §3) — extract once into `store` or a small shared helper namespace.
4. **Committed backup/generated files.** `*.bak` files and `test-results/` + `.tmp/runs/**` artifacts in version control (see §5).
5. **Large single-scope modules.** `store.js` (761 lines) and `discussion.js` (643 lines) are big single IIFEs. Acceptable for a build-free design, but they are approaching the size where a split (e.g. `store` selectors vs. actions) would help.
6. **Long parameterless render functions** rebuild large DOM trees imperatively; fine functionally, but the size is what drives the complexity/MI scores in `discussion.js` and `pages.js`.

---

## 10. Recommendations

**High priority (most quality-per-effort)**

1. **Decompose the two god functions.** Break `ui.js::entryCard` into per-section builders (header, body, tag chips, task controls, gallery) and split the `main.js` subscribe callback into named handlers. This alone lifts the two weakest MI scores and removes the two worst CC outliers.
2. **De-duplicate state classification.** Move `stateKeyOf`/`cardStateKey`/`entryType` and the `HIDDEN_TAG` reserved-tag regex into a single shared location (e.g. `Chippy.store` selectors or a `Chippy.tags` helper) and have all four view modules call it. Eliminates the semantic duplication behind the jscpd clones.
3. **Remove dead code.** Delete `STATE_LABEL`, `showMoveDialog`, `showDeleteDialog`, `entryKindClass` (discussion.js) and the unused `HIDDEN_TAG` in pages.js; delete `io.js.bak` and `store.js.bak`.

**Medium priority**

4. **Replace NUL-byte sentinels** in the markdown pipeline with a collision-proof, text-safe placeholder scheme.
5. **Adopt the lint config as a project gate.** Commit an ESLint flat config (with `CSS`/`Option` in globals and a `complexity` cap), wire it into the `test` script and CI, so complexity and dead-code regressions are caught automatically. Fix the 3 `prefer-const` and 2 `no-shadow` warnings.
6. **Stop versioning generated output.** Add `*.bak`, `test-results/`, and `tests/local/.tmp/` to `.gitignore`.

**Lower priority**

7. **Reduce parser branching** in `format.js`/`ui.js` where readable (table-driven token handling), keeping the existing unit tests as the safety net.
8. **Consider splitting `store.js`** into selectors and actions if it continues to grow.

**Suggested order:** (1)+(3) first — high impact, low risk; then (2); then the tooling gate (5) to lock in the gains; the rest opportunistically.

---

*Metrics generated with jscpd, ESLint v10, and a custom espree-based AST analyzer (cyclomatic complexity, Halstead volume, and the Microsoft Maintainability Index). Figures reflect committed revision `c65e458`.*
