// SPDX-License-Identifier: Apache-2.0
//
// Phase 1 unit tests — format.js (pure parse/serialize transforms).
//
// These complement the regressionharness round-trip (which pins canonical
// reference files byte-for-byte). Here we assert field-level parsing and the
// serialize->parse stability of individual format functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from './_load.mjs';

test('parseDiscussion extracts title, prep and entry fields', () => {
  const md = [
    '# Maria Lopez',
    '',
    '## Preparation',
    '',
    '- Discuss Q2 objectives',
    '',
    '## Entries',
    '',
    '### 2026-02-25 10:40 | tags: task, high | due: 2026-03-05',
    '',
    'Fix the deployment pipeline.',
    ''
  ].join('\n');

  const d = format.parseDiscussion(md, 'Maria Lopez.md');
  assert.equal(d.name, 'Maria Lopez');
  assert.equal(d.prep, '- Discuss Q2 objectives');
  assert.equal(d.entries.length, 1);
  assert.equal(d.entries[0].created_at, '2026-02-25 10:40');
  assert.deepEqual(d.entries[0].tags, ['task', 'high']);
  assert.equal(d.entries[0].due, '2026-03-05');
  assert.equal(d.entries[0].body, 'Fix the deployment pipeline.');
});

test('discussion serialize -> parse is stable', () => {
  const member = {
    name: 'Cloud Migration',
    group: null,
    archived: false,
    prep: '- Confirm cutover window',
    entries: [
      { created_at: '2026-02-25 10:30', tags: ['career'], goal: null, due: null, body: 'Kickoff notes.' },
      { created_at: '2026-02-26 09:00', tags: ['goal', 'goal-a1b2c', 'high'], goal: null, due: '2026-06-30', body: 'Define scope.' }
    ]
  };
  const serialized = format.serializeDiscussion(member);
  const reparsed = format.parseDiscussion(serialized, 'Cloud Migration.md');
  assert.equal(format.serializeDiscussion(reparsed), serialized);
  assert.equal(reparsed.entries[1].due, '2026-06-30');
  assert.deepEqual(reparsed.entries[1].tags, ['goal', 'goal-a1b2c', 'high']);
});

test('navigation round-trips discussions, flags and theme', () => {
  const nav = {
    theme: 'light',
    discussions: [
      { name: 'Alice Johnson', tag: 'Team Members', favorite: false, archived: false },
      { name: 'Bob Smith', tag: 'Team Members', favorite: true, archived: true },
      { name: 'Project Phoenix', tag: null, favorite: false, archived: false }
    ]
  };
  const out = format.serializeNav(nav);
  const back = format.parseNav(out);
  assert.equal(back.theme, 'light');
  assert.equal(back.discussions[1].favorite, true);
  assert.equal(back.discussions[1].archived, true);
  assert.equal(back.discussions[2].tag, null);
});

test('dark theme is the implicit default and is not written', () => {
  const out = format.serializeNav({ theme: 'dark', discussions: [] });
  assert.ok(!out.includes('theme:'));
  assert.equal(format.parseNav(out).theme, 'dark');
});

test('tags / names bullet lists round-trip', () => {
  const tags = ['career', 'goal', 'high', 'task'];
  assert.deepEqual(format.parseTags(format.serializeTags(tags)), tags);
  const names = ['Anna Wehrli', 'Philipp Sommer'];
  assert.deepEqual(format.parseNames(format.serializeNames(names)), names);
});

test('migrateLegacyNav lifts inline Tags / Names sections out of navigation.md', () => {
  const legacy = [
    '# Navigation',
    '',
    '> theme: light',
    '',
    '## Discussions',
    '',
    '- Alice Johnson | tag: Team Members',
    '',
    '## Tags',
    '',
    '- career',
    '- task',
    '',
    '## Names',
    '',
    '- Anna Wehrli'
  ].join('\n');

  const m = format.migrateLegacyNav(legacy);
  assert.equal(m.theme, 'light');
  assert.deepEqual(m.tags, ['career', 'task']);
  assert.deepEqual(m.names, ['Anna Wehrli']);
  assert.equal(m.discussions[0].name, 'Alice Johnson');
});

test('textStats counts lines, words and characters like wc', () => {
  assert.deepEqual(format.textStats(''), { lines: 0, words: 0, chars: 0 });
  assert.deepEqual(format.textStats(null), { lines: 0, words: 0, chars: 0 });
  assert.deepEqual(format.textStats('one'), { lines: 1, words: 1, chars: 3 });
  assert.deepEqual(format.textStats('one\n'), { lines: 1, words: 1, chars: 4 });
  // Markdown markers count as words; blank lines count as lines
  assert.deepEqual(format.textStats('# Title\n\n## Entries\n\n- a  b\n'), { lines: 5, words: 7, chars: 28 });
  // CRLF is one break and one character: same numbers as LF
  assert.deepEqual(format.textStats('a b\r\nc\r\n'), format.textStats('a b\nc\n'));
  // characters are code points (emoji, umlauts count once)
  assert.deepEqual(format.textStats('Zürich 💡'), { lines: 1, words: 2, chars: 8 });
});

test('textStats of a serialized discussion matches the saved text', () => {
  const md = format.serializeDiscussion({ name: 'Alpha', prep: '', entries: [
    { created_at: '2026-10-20 09:00:00', tags: ['task'], goal: null, due: null, body: 'Call the supplier' }
  ] });
  const s = format.textStats(md);
  assert.equal(s.lines, md.split('\n').length - (md.endsWith('\n') ? 1 : 0));
  assert.equal(s.chars, md.length);
  assert.equal(s.words, md.trim().split(/\s+/).length);
});
