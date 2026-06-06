// SPDX-License-Identifier: Apache-2.0
//
// The "Test Execution" meta-discussion: a discussion inside the test dataset
// that records each run's outcome as an entry. The init batch adds it (empty) to
// the skeleton; run.mjs appends one entry per run via appendTestResult().
//
// Entries are written canonically through the app's own format.js serializer, so
// the file stays spec-valid (Phase 4 sees the empty discussion before the entry
// is appended at the very end of the run).
//
// NOTE: the app derives a discussion's filename from its title, so the file is
// "Test Execution.md". For a literal "testresult.md" the title would be
// "testresult" — change TESTRESULT_NAME below.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import '../../../../src/local/format.js'; // defines globalThis.Chippy.format

const fmt = globalThis.Chippy.format;

export const TESTRESULT_NAME = 'Test Execution';
const sanitize = n => String(n).replace(/[^A-Za-z0-9_ -]/g, '');
export const TESTRESULT_FILE = sanitize(TESTRESULT_NAME) + '.md';

// Append one run-result entry to the Test Execution discussion and fold its tags
// into tags.md. No-op (returns false) if the discussion file is absent.
export function appendTestResult(dir, { createdAt, tags = [], body }) {
  const path = join(dir, TESTRESULT_FILE);
  if (!existsSync(path)) return false;

  const member = fmt.parseDiscussion(readFileSync(path, 'utf8'), TESTRESULT_FILE);
  member.entries.push({ created_at: createdAt, tags: tags.slice(), goal: null, due: null, body });
  writeFileSync(path, fmt.serializeDiscussion(member));

  // Keep tags.md consistent (deduped, sorted) if the entry introduces tags.
  const tagsPath = join(dir, 'tags.md');
  if (existsSync(tagsPath)) {
    const union = fmt.parseTags(readFileSync(tagsPath, 'utf8'));
    let changed = false;
    for (const t of tags) if (!union.includes(t)) { union.push(t); changed = true; }
    if (changed) { union.sort((a, b) => a.localeCompare(b)); writeFileSync(tagsPath, fmt.serializeTags(union)); }
  }
  return true;
}

// Append many entries at once (one read/serialize/write), folding all their tags
// into tags.md. `entries` is [{ created_at, tags, body }] in chronological order.
// Returns the number appended; 0 if the discussion file is absent.
export function appendTestResults(dir, entries) {
  const path = join(dir, TESTRESULT_FILE);
  if (!existsSync(path) || !entries || !entries.length) return 0;

  const member = fmt.parseDiscussion(readFileSync(path, 'utf8'), TESTRESULT_FILE);
  for (const e of entries) {
    member.entries.push({ created_at: e.created_at, tags: (e.tags || []).slice(), goal: null, due: null, body: e.body });
  }
  writeFileSync(path, fmt.serializeDiscussion(member));

  const tagsPath = join(dir, 'tags.md');
  if (existsSync(tagsPath)) {
    const union = fmt.parseTags(readFileSync(tagsPath, 'utf8'));
    let changed = false;
    for (const e of entries) for (const t of (e.tags || [])) if (!union.includes(t)) { union.push(t); changed = true; }
    if (changed) { union.sort((a, b) => a.localeCompare(b)); writeFileSync(tagsPath, fmt.serializeTags(union)); }
  }
  return entries.length;
}
