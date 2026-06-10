// SPDX-License-Identifier: Apache-2.0
//
// Phase 1 unit tests — store.js pure helpers (the block store.js exposes
// "for the UI and for tests"). All deterministic: dates and RNG are injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from './_load.mjs';

test('nowISO formats an injected date as YYYY-MM-DD HH:MM:SS (local)', () => {
  // Month is 0-based: index 5 = June.
  const d = new Date(2026, 5, 6, 9, 8, 7);
  assert.equal(store.nowISO(d), '2026-06-06 09:08:07');
});

test('mintGoalId is deterministic under a seeded RNG', () => {
  const zero = () => 0;            // floor(0 * 36) -> 0 -> '0'
  assert.equal(store.mintGoalId(zero), 'goal-00000');
  const id = store.mintGoalId(() => 0.5);
  assert.match(id, /^goal-[0-9a-z]{5}$/);
});

test('extractInlineTags pulls #tags and lowercases them; "# heading" is left alone', () => {
  const r = store.extractInlineTags('Fix #Bug in #API now');
  assert.deepEqual(r.tags, ['bug', 'api']);
  assert.ok(!r.text.includes('#'));

  const heading = store.extractInlineTags('# Heading stays');
  assert.deepEqual(heading.tags, []);
  assert.equal(heading.text, '# Heading stays');
});

test('autoLinkUrls labels a bare URL with the preceding word, else the domain', () => {
  // the preceding word ("see") is consumed and becomes the link label
  assert.equal(
    store.autoLinkUrls('see https://example.com/x'),
    '[see](https://example.com/x)'
  );
  // domain fallback when nothing precedes the URL
  assert.equal(
    store.autoLinkUrls('https://example.com/a'),
    '[example.com](https://example.com/a)'
  );
  // underscores in the label word become spaces
  assert.equal(
    store.autoLinkUrls('my_link https://foo.com'),
    '[my link](https://foo.com)'
  );
});

test('extractNameTokens reads @[Full Name] references', () => {
  assert.deepEqual(
    store.extractNameTokens('ping @[Maria Lopez] and @[James Okafor]'),
    ['Maria Lopez', 'James Okafor']
  );
});

test('parseSearchQuery splits #tags, @names and freetext', () => {
  const p = store.parseSearchQuery('#task @[Maria Lopez] deploy');
  assert.deepEqual(p.tags, ['task']);
  assert.deepEqual(p.names, ['maria lopez']);
  assert.equal(p.text, 'deploy');
});

test('extractLinks finds markdown links and bare URLs, skips image refs', () => {
  const links = store.extractLinks('see [Docs](https://x.com/d), ![pic](Img/p.jpg) and https://y.com');
  const urls = links.map(l => l.url);
  assert.ok(urls.includes('https://x.com/d'));
  assert.ok(urls.includes('https://y.com'));
  assert.ok(!urls.some(u => u.endsWith('.jpg')));
});

test('applyUnifiedFilter requires tags AND names AND freetext to all match', () => {
  const entries = [
    { tags: ['task', 'high'], body: 'deploy pipeline with @[Maria Lopez]' },
    { tags: ['task'], body: 'unrelated note' },
    { tags: ['goal'], body: 'deploy with @[Maria Lopez]' }
  ];
  const hit = store.applyUnifiedFilter(entries, '#task @[Maria Lopez] deploy');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].body, 'deploy pipeline with @[Maria Lopez]');
});

test('splitBodyParts separates comment, legacy markers, Updated line and actions', () => {
  const body = [
    'Fix the deployment pipeline.',
    '',
    'Resolved: 2026-05-20 10:00:00',
    '',
    'Updated: 2026-05-18 09:00:00',
    '',
    'Updated: 2026-05-21 09:00:00',
    '',
    'Task Resolution Actions',
    '- 2026-05-18 : Reworked the pipeline.',
    '- 2026-05-20 : → DONE'
  ].join('\n');
  const p = store.splitBodyParts(body);
  assert.equal(p.comment, 'Fix the deployment pipeline.');
  assert.deepEqual(p.markers, ['Resolved: 2026-05-20 10:00:00']);
  assert.equal(p.updated, 'Updated: 2026-05-21 09:00:00'); // latest wins, no duplicates
  assert.deepEqual(p.bullets, [
    '- 2026-05-18 : Reworked the pipeline.',
    '- 2026-05-20 : → DONE'
  ]);
});

test('joinBodyParts reassembles canonically: comment, markers, Updated, actions last', () => {
  const e = { tags: ['task'] };
  const parts = {
    comment: 'Fix the deployment pipeline.',
    markers: ['Resolved: 2026-05-20 10:00:00'],
    updated: 'Updated: 2026-05-21 09:00:00',
    bullets: ['- 2026-05-20 : → DONE']
  };
  assert.equal(store.joinBodyParts(parts, e), [
    'Fix the deployment pipeline.',
    '',
    'Resolved: 2026-05-20 10:00:00',
    '',
    'Updated: 2026-05-21 09:00:00',
    '',
    'Task Resolution Actions',
    '- 2026-05-20 : → DONE'
  ].join('\n'));
});

test('splitBodyParts/joinBodyParts round-trip a plain comment unchanged', () => {
  const body = 'Just a note with **markdown**.\n\nSecond paragraph.';
  const p = store.splitBodyParts(body);
  assert.equal(p.comment, body);
  assert.equal(p.updated, null);
  assert.deepEqual(p.markers, []);
  assert.deepEqual(p.bullets, []);
  assert.equal(store.joinBodyParts(p, { tags: [] }), body);
});

test('resolvedDate prefers the latest "→ DONE" action over the legacy marker', () => {
  const e = { body: 'x\n\nResolved: 2026-01-01 08:00:00\n\nTask Resolution Actions\n- 2026-02-02 : → DONE\n- 2026-03-03 : → DONE' };
  assert.equal(store.resolvedDate(e), '2026-03-03');
  assert.equal(store.resolvedDate({ body: 'x\n\nResolved: 2026-01-01 08:00:00' }), '2026-01-01');
  assert.equal(store.resolvedDate({ body: 'open task' }), null);
});

test('applyEditTagRules promotes a comment to task/goal with defaults', () => {
  // comment -> task: gets default 'low'
  assert.deepEqual(store.applyEditTagRules(['meeting', 'task']), ['meeting', 'task', 'low']);
  // comment -> goal: mints a goal id (deterministic rng) and default 'low'
  assert.deepEqual(
    store.applyEditTagRules(['career', 'goal'], () => 0),
    ['career', 'goal', 'goal-00000', 'low']
  );
  // existing goal keeps its id, no second mint
  assert.deepEqual(
    store.applyEditTagRules(['goal', 'goal-a1b2c', 'high']),
    ['goal', 'goal-a1b2c', 'high']
  );
});

test('applyEditTagRules dedupes and lets the last priority win', () => {
  assert.deepEqual(store.applyEditTagRules(['task', 'low', 'task', 'high']), ['task', 'high']);
  // plain comment with a priority keeps it, no kind default added
  assert.deepEqual(store.applyEditTagRules(['note', 'medium']), ['note', 'medium']);
  // plain comment untouched
  assert.deepEqual(store.applyEditTagRules(['note']), ['note']);
});
