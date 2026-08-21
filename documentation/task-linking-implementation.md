# Task Linking (Connected Tasks) — Implementation Proposal

## Executive Summary

This proposal details the implementation of **task linking** in Chippy: a task, followup, or idea that lives in one discussion (its **origin**) can be **connected** to other discussions and will appear in each of them, resolved live from the origin. There is a single source of truth — the origin entry — so state, priority, due date, text, and actions never diverge, and aggregate views never double-count.

The model is the **origin + reference** design evaluated in `../claude` project notes (`multi-discussion-tasks-reference-model.md`). It was chosen over a replicated-copies model because it keeps one source of truth, avoids cross-view deduplication, and never duplicates images. Its costs — a resolution step in the load/render path and a small amount of referential bookkeeping — are contained by two deliberate simplifications the team chose: identity is **minted on first connect** (no data migration), and deletion is a **rare, non-cascading** operation (a lost origin simply leaves a broken link).

Estimated effort: **3–4 sprints**, split into five independently shippable phases.

Scope: **tasks, followups, and ideas.** Goals are out of scope (they keep their existing single-discussion `goal-<id>` trail).

---

## 1. Terminology

- **Origin** — the discussion where the task physically lives and where all its content and state are stored.
- **Link tag** — the identity `<origin-stem>:link-<id>` carried by the origin entry and by every reference to it.
- **Reference** (a.k.a. **link**) — a lightweight entry appended to another discussion's history that points at the origin. It is resolved to the origin task at render time.
- **Connect** — the action of creating a reference in another discussion.
- **Disconnect** — removing a reference from a discussion (the origin is untouched).

---

## 2. Data Model & Storage

### 2.1 The link tag: `<origin-stem>:link-<id>`

A new reserved tag family identifies a linked task. It is **minted only when a task is first connected** — tasks that are never shared carry no link tag and are byte-identical to today.

- **Format:** `<origin-stem>:link-<id>` where
  - `<origin-stem>` is the **sanitized discussion name** (the `.md` filename stem, `[A-Za-z0-9_ -]`, per `io.js:sanitizeName`). It contains no comma and no colon, so it is safe inside the comma-separated `tags:` field and unambiguous to split on the first colon.
  - `<id>` is a 5-char base-36 suffix, minted exactly like `goal-<id>` (`store.js:mintGoalId` :77).
  - Example: `Maria Lopez:link-k7f2a`.
- **Stable key vs resolution hint.** The `<id>` is the durable identity; the `<origin-stem>` prefix is a resolution hint that names the origin file. Renaming the origin discussion rewrites the prefix on the origin entry and on every reference (§6.4), analogous to the existing image-ref rewrite on rename (`io.js:196-211`).
- **Origin vs reference discriminator (no separate marker needed).** In discussion `D`, an entry whose link-tag prefix equals `sanitizeName(D)` is the **origin**; an entry whose prefix names a *different* discussion is a **reference**.
- **Reserved & hidden.** Add `[A-Za-z0-9_ -]+:link-[a-z0-9]{5}` to the `RESERVED` regex (`taxonomy.js:18`) so the tag is hidden from tag chips, excluded from the tag union/counts (`store.js:getAllTags` :894), and stripped from visible tags in `exportContribution` (`store.js:1027`). It is **not** added to `PROMOTABLE` (users never type it).

### 2.2 The origin entry

Unchanged except for one added hidden tag on first connect:

```markdown
### 2026-08-18 10:30:00 | tags: task, high, Maria Lopez:link-k7f2a | due: 2026-08-25
Coordinate the vendor security review with legal.
```

Renders exactly as today (the link tag is hidden). Holds all state, actions, due, and images.

### 2.3 The reference entry

Appended to the target discussion at connect time, timestamped **at the moment of connection** (so it lands in that discussion's history at the date it became relevant there):

```markdown
### 2026-08-18 14:05:00 | tags: task, Maria Lopez:link-k7f2a
Coordinate the vendor security review with legal.
```

- `created_at` = connect timestamp — the reference's position in the target discussion.
- Carries the same `<origin-stem>:link-<id>` link tag (prefix names the origin, so it is recognised as a reference).
- Carries the **kind tag** (`task`/`followup`/`idea`) so a *broken* reference can still show the right kind/icon without loading the origin.
- **Body = a cached one-line title** (the origin's first line at connect time). This is a read-only fallback used only when the origin can't be resolved (broken state); when the origin resolves, its live body is shown instead. The cached title keeps the raw Markdown human-readable and lets a broken link display *what* it pointed at.
- The reference stores **no state tags, no actions, no due, no images** — those are always read from (and written to) the origin.

### 2.4 No backfill

Existing entries are never rewritten to add link tags. An id is minted lazily on the first `connect`. Consequence: the on-disk format change is invisible to any folder until the user connects a task — minimal footprint, minimal regression-harness impact.

### 2.5 `datadefinition.md` additions (Phase 5)

Add to §2.2 Reserved tags: the `<origin-stem>:link-<id>` family. Add a new subsection describing the reference entry, the connect timestamp semantics, resolution, and the broken state. Note that references carry only the link tag + kind tag + a cached-title body.

---

## 3. Resolution Model

Resolution turns a reference into the live origin task at read time.

1. **Detect.** For each entry in the discussion being rendered, read its link tag. Prefix ≠ current discussion ⇒ reference.
2. **Locate origin (targeted load).** From the prefix, load the origin `.md` (only if not already in `state.members`) and find the entry whose link tag `<id>` matches. This is a single targeted file read, not `ensureAllLoaded`.
3. **Three outcomes / visual states** (drives the badge in §5.3):
   - **Origin** — prefix = current discussion → render as-is, no badge.
   - **Connected** — origin found → render the resolved origin content with a **tasklink icon**; the card's controls act on the **origin** (its `_member`, `created_at`, `idx`), so existing mutation wiring writes to the origin automatically.
   - **Broken** — origin missing / unreadable / cloud-placeholder (`store.js:782-786`) → render a **broken icon** using the reference's cached kind + title. Shown in **history only**; **omitted from the right-hand panels** (§5.2).
4. **Placement.** In the target discussion the resolved card is grouped under the **reference's** `created_at` (connect date), while its mutation identity is the origin's. Show a small "linked from *&lt;origin&gt;* · &lt;connect date&gt;" line (the origin name is recoverable from the tag prefix via nav).

Because content and actions live at the origin and the resolved card is built with the origin's coordinates, **the seven mutation functions need no change** — `setTaskState`, `cyclePriority`, `setDue`, `editEntry`, `toggleMute`, `appendAction`, `updateIdeaState` already act on `(member, created_at, idx)`, which now points at the origin. This is the key reason the model stays small.

---

## 4. Store API Changes (`store.js`)

**New helpers**
- `mintLinkId()` — 5-char base-36, mirrors `mintGoalId` (:77).
- `linkTagOf(tags)` → `"<stem>:link-<id>"` or `null`.
- `parseLinkTag(tag)` → `{ stem, id }` (split on first `:`).
- `isReference(entry, memberName)` → link tag present and `stem !== sanitizeName(memberName)`.
- `resolveOrigin(entry)` → `{ member, entry }` or `{ broken: true }`; performs the targeted origin load and id match.

**New operations**
- `connectToDiscussion(sourceMember, entryId, targetMember)`:
  1. Resolve to the **origin** (connecting from a reference points the new link at the origin, never at another reference).
  2. If the origin has no link tag, mint one (`<originStem>:link-<id>`), add it, save the origin.
  3. If `targetMember` is the origin or already has a reference with this id → no-op (idempotent).
  4. Append a reference entry (§2.3) to `targetMember`, timestamped now; save the target.
  5. Emit `entryConnected`.
- `disconnectFromDiscussion(targetMember, linkId)` — remove the reference entry from `targetMember`; save; emit. Origin untouched. (This is "delete from another discussion = remove the link.")

**Modified**
- `collectEntries` (:806) — **skip reference stubs** (an entry that `isReference` for its own member). Result: cross-views (kanban, Ro3, calendar, dashboard, search, summary) see each linked task exactly once, at its origin — no dedup workstream needed.
- `deleteEntry` (:760) — unchanged in mechanics; deleting an **origin** simply removes it and leaves references to break (§6.3). Deletion remains a rare operation (§7).
- Rename cascade (`io.js:renameDiscussion` :196) — also rewrite the `<stem>:` prefix of link tags across the origin and all references (§6.4).

---

## 5. Rendering Changes

### 5.1 History (`discussion.js:renderHistory` :297-318)
- Resolve each reference (§3); render the resolved origin card grouped under the reference's connect date; attach the tasklink/broken state.

### 5.2 Right-hand panels (`discussion.js` task panel :412-425, idea panel :515-522)
- Resolve references so a connected open task/idea appears in the panel of the discussion it's connected to (firm requirement).
- **Omit broken references** — panels are working lists; a task whose origin is gone should not hold a working slot. Broken links remain visible only in the history.

### 5.3 `entryCard` (`ui.js:570-818`)
- New `opts.linkState` ∈ `origin` | `link` | `broken`.
  - `origin` → no change.
  - `link` → **tasklink icon** + "linked from &lt;origin&gt;" tooltip.
  - `broken` → **broken icon**, minimal card from cached kind/title, controls suppressed.
- New **Connect control** (icon beside Move, :662-666): opens the discussion picker (`moveDialog` :546-558) filtered to discussions the task isn't the origin of and isn't already connected to; calls `connectToDiscussion`. Provide the inverse (**Disconnect**) on reference cards → `disconnectFromDiscussion`.
- **Hide plain Move on reference cards** (Move relocates the origin; from a reference that's confusing). Move stays on origin/normal cards.

---

## 6. Edge Cases & Referential Integrity

### 6.1 Cloud-placeholder / unreadable origin
Resolves to **broken** (§3.3). The cached title makes it informative. No error, no crash.

### 6.2 Connect idempotency & self-connect
Connecting to the origin or to an already-connected discussion is a no-op. Connecting from a reference resolves to the origin first.

### 6.3 Deleting the origin
Just delete it; **do nothing to the backlinks.** They become broken and follow §3.3. No cascade, no re-home, no backlink scan. Acceptable because deletion is rare (§7).

### 6.4 Renaming the origin
Rewrite the `<stem>:` prefix of the link tag on the origin and every reference — same find-and-rewrite pattern as image refs on rename (`io.js:196-211`). Requires visiting references; do it opportunistically on load/resolve and on rename when discussions are loaded.

### 6.5 Archiving the origin
Treated as "origin not currently loadable" → references render broken. Either leave as-is, or (nicety) allow the resolver to read from `<stem>.archive.md`. Recommend leave-as-broken for Phase 1–4.

### 6.6 Same-screen identity
References are resolved to the origin's `created_at`/`_member`; within one discussion a task has at most one reference, so DOM keys (`dataset.entryId`) don't collide. Cross-views skip stubs, so they render one card. No collision in scope.

---

## 7. Deletion Philosophy

Tasks are **not normally deleted** — that is bad practice. A task disappears from working views by being set to **Done** or **Obsolete** (closed-state tags, `store.js:39`), which leaves history intact and drops it from open lists, kanban working columns, and Ro3. Because the origin is the single source of truth, a Done/Obsolete change propagates to every connected discussion automatically (each resolves the now-closed origin and drops it from its working panel while keeping it in history). Outright origin deletion is exceptional, so the rare broken backlink (§6.3) is an acceptable, clearly-signalled state rather than something to engineer a cascade around.

---

## 8. Phased Plan

### Phase 1 — Identity, connect/disconnect, resolution core (store) — ~1 sprint
- `taxonomy.js`: reserved-tag regex for `<stem>:link-<id>`; `linkTagOf`/`parseLinkTag`/`sharedKindOf` helpers.
- `store.js`: `mintLinkId`, `isReference`, `resolveOrigin`, `connectToDiscussion`, `disconnectFromDiscussion`; `collectEntries` skips stubs.
- Format: reference-entry serialize/parse round-trips (no header schema change; it's an ordinary entry with the link tag).
- **Acceptance:** connect a task A→B in the store; B's file gains a reference; origin gains a link tag; disconnect removes B's reference; cross-views still count the task once. Covered by unit tests.

### Phase 2 — Render resolution + states — ~1 sprint
- `discussion.js`: resolve references in history and in the task/idea panels; group by connect date; omit broken from panels.
- `ui.js entryCard`: `linkState` badge (tasklink / broken); "linked from" tooltip.
- **Acceptance:** open B → the connected task shows in history and the right panel with a tasklink icon; controls mutate the origin; a task whose origin is removed shows broken in history and vanishes from the panel.

### Phase 3 — Connect UI — ~0.5–1 sprint
- Connect icon + picker; Disconnect on reference cards; hide Move on references.
- **Acceptance:** end-to-end connect/disconnect from the card UI; idempotent; picker excludes origin and existing connections.

### Phase 4 — Robustness — ~0.5 sprint
- Broken-state polish; origin-rename tag rewrite (§6.4); archive behavior (§6.5); verify targeted-load performance on a discussion with several references.
- **Acceptance:** rename an origin → links still resolve; a discussion with N references opens with N targeted loads (measured), not a full load.

### Phase 5 — Tests & docs — ~0.5–1 sprint
- Regression harness: reference data with one connected task; byte-pinned round-trip; e2e for connect / disconnect / resolve / broken / propagated Done.
- Update `datadefinition.md` (§2.5), `documentation.md`, and `changelog.md`.
- **Acceptance:** green regression harness; datadefinition matches on-disk reality.

---

## 9. Test Strategy

- **Unit (Node harness):** `linkTagOf`/`parseLinkTag`; `isReference` origin-vs-reference discrimination; `connectToDiscussion` mints once and is idempotent; `disconnectFromDiscussion` leaves origin intact; `collectEntries` excludes stubs (aggregate counts ×1).
- **Round-trip (byte-pinned):** a folder with an origin + one reference serializes/parses without drift.
- **e2e (Playwright):** connect from the card; verify the task appears in the target's history + panel with the tasklink icon; change state from the target and verify the origin file changed; delete the origin and verify broken-in-history / absent-in-panel; disconnect and verify only the reference is removed.
- **Resolution/perf:** opening a discussion with references issues only targeted origin loads.

---

## 10. Risks & Mitigations

- **Resolution in the render path** is new. *Mitigation:* it is a targeted load keyed by the tag prefix; measured in Phase 4; cross-views are unaffected (they skip stubs).
- **Broken links from a lost origin.** *Mitigation:* explicit broken state (icon + cached title), hidden from working panels; deletion is rare by design (§7).
- **Rename cascade.** *Mitigation:* reuse the existing image-ref rewrite pattern; rewrite link-tag prefixes in the same pass.
- **Regression-harness byte-pinning.** *Mitigation:* additive tag + ordinary reference entry; add reference data deliberately in Phase 5. No migration (ids minted on connect only).
- **Cross-version files.** An older build sees the reference as an ordinary (kind-tagged) entry with an unknown tag and the origin's link tag as a stray tag; it won't resolve but won't corrupt. Acceptable and documented.

---

## 11. Future / Out of Scope

- **Goals** are not linkable in this phase.
- **Discussion-scoped cross-views** (e.g. "kanban of everything relevant to B, including connected tasks") would resolve references inside the `discTag` path — deferred; the default cross-views show tasks at their origin.
- **A `links.chippy.md` index** for peer discovery / targeted propagation without any origin load — a possible optimization if resolution cost ever matters at scale; not needed now.

---

## 12. Key Code References
- Identity precedent: `store.js:mintGoalId` :77; reserved tags `taxonomy.js:18`.
- Mutations (unchanged, act on origin coordinates): `store.js` :482–670.
- Cross-view collection: `store.js:collectEntries` :806.
- Lazy load / unreadable-file handling: `store.js:ensureAllLoaded` :787 (:782–786).
- Render + panels: `discussion.js:renderHistory` :297, panels :412–522.
- Card + controls + Move/dialog: `ui.js:entryCard` :570, `moveDialog` :546, Move control :662.
- Rename/image-ref rewrite pattern: `io.js:renameDiscussion` :196.
