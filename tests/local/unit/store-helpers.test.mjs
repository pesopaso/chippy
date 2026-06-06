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
