// SPDX-License-Identifier: Apache-2.0
//
// renderEntryText wraps the trailing action section ("Task Resolution Actions"
// and its siblings + dated bullets) in a .entry-action-log block so it can be
// styled apart from the comment. Bodies without an action section render as
// before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../../src/local/format.js');
require('../../../src/local/taxonomy.js');
require('../../../src/local/store.js');
require('../../../src/local/ui.js');
const { renderEntryText } = globalThis.Chippy.ui;

// No DOMPurify under Node: sanitize() warns and passes markup through.
console.warn = () => {};

test('task action section is wrapped in .entry-action-log after the comment', () => {
  const body = 'Call the vendor.\n\nTask Resolution Actions\n- 2026-10-01 : → IN PROGRESS\n- 2026-10-05 : → DONE';
  const html = renderEntryText(body);
  const at = html.indexOf('<div class="entry-action-log">');
  assert.ok(at > 0, 'wrapper present after the comment');
  assert.ok(html.indexOf('Call the vendor.') < at, 'comment stays before the log');
  const log = html.slice(at);
  assert.match(log, /Task Resolution Actions/);
  assert.match(log, /2026-10-01/);
  assert.match(log, /2026-10-05/);
  assert.ok(log.trimEnd().endsWith('</div>'));
});

test('Updated line stays outside the action log', () => {
  const body = 'Text\n\nUpdated: 2026-10-02 10:00:00\n\nFollowup Actions\n- 2026-10-03 : called';
  const html = renderEntryText(body);
  const at = html.indexOf('entry-action-log');
  assert.ok(html.indexOf('Updated: 2026-10-02') < at);
  assert.match(html.slice(at), /Followup Actions/);
});

test('bodies without an action section are not wrapped', () => {
  assert.doesNotMatch(renderEntryText('Just a comment\n- a plain bullet'), /entry-action-log/);
  assert.doesNotMatch(renderEntryText(''), /entry-action-log/);
});

test('an action-only body renders just the log', () => {
  const html = renderEntryText('Idea Actions\n- 2026-10-04 : → EXPLORED');
  assert.ok(html.startsWith('<div class="entry-action-log">'));
});
