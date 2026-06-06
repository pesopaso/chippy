// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 — clean-room data validator.
//
// Reads the on-disk Markdown a run produced and checks it against the spec in
// documentation/datadefinition.md. It deliberately does NOT import the app's
// format.js: validating the app's output with the app's own parser would let a
// shared parse/serialize bug hide itself. This is an independent, spec-derived
// reader — the same clean-room principle as regressionharness.
//
// Two check tiers:
//   validateStructural(seed)   — invariants that hold on ANY non-empty dataset,
//                                including a partial one from an interrupted run.
//   validateCompleteness(seed) — assertions that assume the FULL dataset
//                                (golden snapshot); only meaningful in "full" mode.
//
// Each check returns findings: { level: 'error', code, message, file }.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RESERVED_INDEX = new Set(['navigation.md', 'tags.md', 'names.md', 'summary.md']);

// Reserved tags from datadefinition.md §2.2 (current + accepted legacy).
const TASK_STATE_TAGS = new Set([
  'opentask', 'inprogresstask', 'checktask', 'onholdtask', 'purgatorytask',
  'resolvedtask', 'obsoletetask', 'resolvedfollowup',
  'inprogress', 'onhold', 'purgatory' // legacy, accepted on read
]);
const GOAL_STATE_TAGS = new Set(['achievedgoal', 'canceledgoal', 'resolvedgoal']);
const PRIORITY_TAGS = new Set(['high', 'medium', 'low']);
const KIND_TAGS = new Set(['task', 'followup', 'goal']);

const CREATED_AT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;
const GOAL_ID_RE = /^goal-[0-9a-z]{5}$/;
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------ reading ------------------------------- */

function bullets(text) {
  return text.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
}

function parseDiscussionFile(name, text) {
  const lines = text.split('\n');
  const title = (lines.find(l => l.startsWith('# ')) || '').slice(2);
  const prepIdx = lines.findIndex(l => l === '## Preparation');
  const entriesIdx = lines.findIndex(l => l === '## Entries');

  const entries = [];
  if (entriesIdx !== -1) {
    let cur = null;
    for (let k = entriesIdx + 1; k < lines.length; k++) {
      const l = lines[k];
      if (l.startsWith('### ')) {
        if (cur) entries.push(cur);
        cur = { header: l.slice(4), bodyLines: [] };
      } else if (cur) cur.bodyLines.push(l);
    }
    if (cur) entries.push(cur);
  }

  const parsed = entries.map(e => {
    const parts = e.header.split(' | ');
    const created_at = parts[0];
    let tags = [], goal = null, due = null;
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith('tags:')) {
        const v = p.slice('tags:'.length).trim();
        tags = v ? v.split(', ').filter(Boolean) : [];
      } else if (p.startsWith('goal: ')) goal = p.slice('goal: '.length);
      else if (p.startsWith('due: ')) due = p.slice('due: '.length);
    }
    return { created_at, tags, goal, due, body: e.bodyLines.join('\n').trim() };
  });

  return { fileName: name, title, hasPrep: prepIdx !== -1, hasEntries: entriesIdx !== -1, prepIdx, entriesIdx, entries: parsed };
}

function parseNav(text) {
  const theme = (text.match(/^> theme: (.+)$/m)?.[1] || 'dark').trim();
  const discussions = [];
  const lines = text.split('\n');
  const start = lines.findIndex(l => l === '## Discussions');
  if (start !== -1) {
    for (let k = start + 1; k < lines.length; k++) {
      if (lines[k].startsWith('## ')) break;
      if (!lines[k].startsWith('- ')) continue;
      const parts = lines[k].slice(2).split(' | ');
      const d = { name: parts[0], tag: null, favorite: false, archived: false };
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith('tag: ')) d.tag = p.slice('tag: '.length);
        else if (p === 'favorite') d.favorite = true;
        else if (p === 'archived') d.archived = true;
      }
      discussions.push(d);
    }
  }
  return { theme, discussions };
}

export function readSeed(dir) {
  if (!existsSync(dir)) throw new Error(`seed dir does not exist: ${dir}`);
  const all = readdirSync(dir);
  const discussionFiles = all.filter(
    f => f.endsWith('.md') && !f.endsWith('.archive.md') && !RESERVED_INDEX.has(f)
  );

  const discussions = discussionFiles.map(f =>
    parseDiscussionFile(f, readFileSync(join(dir, f), 'utf8'))
  );

  const navText = existsSync(join(dir, 'navigation.md')) ? readFileSync(join(dir, 'navigation.md'), 'utf8') : null;
  const tagsText = existsSync(join(dir, 'tags.md')) ? readFileSync(join(dir, 'tags.md'), 'utf8') : null;
  const namesText = existsSync(join(dir, 'names.md')) ? readFileSync(join(dir, 'names.md'), 'utf8') : null;

  return {
    dir,
    discussions,
    nav: navText ? parseNav(navText) : null,
    tags: tagsText ? bullets(tagsText) : null,
    names: namesText ? bullets(namesText) : null
  };
}

/* --------------------------- helpers ---------------------------------- */

function usedTags(seed) {
  const s = new Set();
  for (const d of seed.discussions) for (const e of d.entries) for (const t of e.tags) s.add(t);
  return s;
}
function referencedNames(seed) {
  const s = new Set();
  const re = /@\[([^\]]+)\]/g;
  for (const d of seed.discussions) for (const e of d.entries) {
    let m; while ((m = re.exec(e.body))) s.add(m[1]);
  }
  return s;
}
function isSorted(arr) {
  for (let i = 1; i < arr.length; i++) if (arr[i - 1].localeCompare(arr[i]) > 0) return false;
  return true;
}
function hasDupes(arr) { return new Set(arr).size !== arr.length; }

/* --------------------------- structural ------------------------------- */

export function validateStructural(seed) {
  const out = [];
  const err = (code, message, file) => out.push({ level: 'error', code, message, file });

  for (const d of seed.discussions) {
    if (!d.title) err('discussion.no-title', 'missing "# <title>" heading', d.fileName);
    if (!d.hasPrep) err('discussion.no-prep', 'missing "## Preparation" section', d.fileName);
    if (!d.hasEntries) err('discussion.no-entries', 'missing "## Entries" section', d.fileName);
    if (d.hasPrep && d.hasEntries && d.entriesIdx < d.prepIdx)
      err('discussion.section-order', '"## Entries" must come after "## Preparation"', d.fileName);

    // entries chronological, oldest first
    let prev = '';
    for (const e of d.entries) {
      if (!CREATED_AT_RE.test(e.created_at))
        err('entry.bad-created-at', `invalid created_at "${e.created_at}"`, d.fileName);
      if (prev && e.created_at < prev)
        err('entry.out-of-order', `entry ${e.created_at} precedes ${prev}`, d.fileName);
      prev = e.created_at || prev;

      if (e.body === '') err('entry.empty-body', `empty body for ${e.created_at}`, d.fileName);
      if (e.due != null && !DUE_RE.test(e.due))
        err('entry.bad-due', `invalid due "${e.due}" for ${e.created_at}`, d.fileName);

      // state tags must be known; only one task-state and one goal-state allowed
      const taskStates = e.tags.filter(t => TASK_STATE_TAGS.has(t));
      const goalStates = e.tags.filter(t => GOAL_STATE_TAGS.has(t));
      if (taskStates.length > 1)
        err('entry.multi-task-state', `multiple task-state tags [${taskStates}] for ${e.created_at}`, d.fileName);
      if (goalStates.length > 1)
        err('entry.multi-goal-state', `multiple goal-state tags [${goalStates}] for ${e.created_at}`, d.fileName);

      // every goal entry carries exactly one goal-<id> identity tag
      if (e.tags.includes('goal')) {
        const ids = e.tags.filter(t => GOAL_ID_RE.test(t));
        if (ids.length !== 1)
          err('goal.identity', `goal entry ${e.created_at} must carry one goal-<id> tag (found ${ids.length})`, d.fileName);
      }
      // a priority tag, if present, must be valid
      for (const t of e.tags) {
        if (/^(high|medium|low)$/.test(t) && !PRIORITY_TAGS.has(t))
          err('entry.bad-priority', `invalid priority "${t}"`, d.fileName);
      }
    }

    // image references: must live under the discussion subfolder, no traversal
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    for (const e of d.entries) {
      let m;
      while ((m = imgRe.exec(e.body))) {
        const ref = m[1];
        if (ref.includes('..'))
          err('image.traversal', `image ref escapes folder: "${ref}"`, d.fileName);
        else if (!ref.startsWith('http') && existsSync(seed.dir)) {
          const abs = join(seed.dir, ref);
          if (!existsSync(abs) || !statSync(abs).isFile())
            err('image.missing', `image ref not found on disk: "${ref}"`, d.fileName);
        }
      }
    }
  }

  // index files: sorted + deduped
  if (seed.tags) {
    if (hasDupes(seed.tags)) err('tags.dupes', 'tags.md contains duplicates', 'tags.md');
    if (!isSorted(seed.tags)) err('tags.unsorted', 'tags.md is not alphabetically sorted', 'tags.md');
  }
  if (seed.names) {
    if (hasDupes(seed.names)) err('names.dupes', 'names.md contains duplicates', 'names.md');
    if (!isSorted(seed.names)) err('names.unsorted', 'names.md is not sorted', 'names.md');
  }

  // cross-file: every used tag / referenced name must be present in the union
  if (seed.tags) {
    const known = new Set(seed.tags);
    for (const t of usedTags(seed))
      if (!known.has(t)) err('tags.missing-union', `tag "${t}" used in a discussion but absent from tags.md`, 'tags.md');
  }
  if (seed.names) {
    const known = new Set(seed.names);
    for (const n of referencedNames(seed))
      if (!known.has(n)) err('names.missing-union', `name "${n}" referenced but absent from names.md`, 'names.md');
  }

  // cross-file: every discussion file appears in navigation.md
  if (seed.nav) {
    const navNames = new Set(seed.nav.discussions.map(d => d.name));
    for (const d of seed.discussions)
      if (!navNames.has(d.title))
        err('nav.missing-discussion', `discussion "${d.title}" (${d.fileName}) not listed in navigation.md`, 'navigation.md');
  }

  return out;
}

/* -------------------------- completeness ------------------------------ */
// Exact golden comparison: every file under goldenDir must exist byte-for-byte
// in the seed. Only run in "full" mode (creation completed). Returns findings.

export function validateCompleteness(seed, goldenDir) {
  const out = [];
  const err = (code, message, file) => out.push({ level: 'error', code, message, file });
  if (!existsSync(goldenDir)) return out; // no golden snapshot yet -> nothing to compare

  const goldenFiles = readdirSync(goldenDir).filter(f => f.endsWith('.md'));
  if (goldenFiles.length === 0) return out;

  for (const f of goldenFiles) {
    const want = readFileSync(join(goldenDir, f), 'utf8');
    const seedFile = join(seed.dir, f);
    if (!existsSync(seedFile)) { err('golden.missing', `expected file not produced: ${f}`, f); continue; }
    const got = readFileSync(seedFile, 'utf8');
    if (got !== want) err('golden.mismatch', `file differs from golden snapshot: ${f}`, f);
  }
  return out;
}
