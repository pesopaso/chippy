// SPDX-License-Identifier: Apache-2.0
//
// Line-ending tolerance — parsers accept CRLF input (a git checkout with
// eol=crlf, a Windows editor, the introduction template) and produce exactly
// the same result as for LF input. Serialization always writes LF, so a
// re-saved file is normalized to the canonical form.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from './_load.mjs';

const LF = [
  '# Alice', '', '## Preparation', '', 'Prep note.', '', '## Entries', '',
  '### 2026-08-25 09:00:00 | tags: task, high | due: 2026-09-01', '',
  'Do the thing.', '',
  'Task Resolution Actions', '- 2026-08-25 : → WIP', ''
].join('\n');
const CRLF = LF.replace(/\n/g, '\r\n');

test('parseDiscussion: CRLF input parses identically to LF', () => {
  const a = format.parseDiscussion(LF, 'Alice.md');
  const b = format.parseDiscussion(CRLF, 'Alice.md');
  assert.equal(a.entries.length, 1);
  assert.deepEqual(b, a);
  assert.deepEqual(b.entries[0].tags, ['task', 'high']);
  assert.equal(b.entries[0].due, '2026-09-01');
});

test('parseDiscussion: re-serializing CRLF input yields canonical LF', () => {
  const out = format.serializeDiscussion(format.parseDiscussion(CRLF, 'Alice.md'));
  assert.ok(!out.includes('\r'), 'no CR in serialized output');
  assert.equal(out, format.serializeDiscussion(format.parseDiscussion(LF, 'Alice.md')));
});

test('parseNav / parseTags / parseSummary tolerate CRLF', () => {
  const nav = format.parseNav('# Navigation\r\n\r\n## Discussions\r\n\r\n- Maria | tag: People | favorite | sensitive\r\n');
  assert.deepEqual(nav.discussions[0],
    { name: 'Maria', tag: 'People', favorite: true, archived: false, sensitive: true });
  assert.deepEqual(format.parseTags('# Tags\r\n\r\n- career\r\n- task\r\n'), ['career', 'task']);
  const s = format.parseSummary('> api_url: http://x\r\n\r\n### 2026-01-01 09:00 | range: week | id: abcde\r\n\r\nBody line.\r\n');
  assert.equal(s.api_url, 'http://x');
  assert.equal(s.summaries[0].body, 'Body line.');
});
