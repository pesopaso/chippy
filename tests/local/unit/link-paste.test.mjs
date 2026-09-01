// linkifyPaste — the pure decision behind "paste a URL over selected text
// becomes a markdown link with the selection as its title". The rule is
// narrow by design: anything it declines falls through to the browser's
// default paste, so existing link behaviour is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../../src/local/taxonomy.js'); // ui.js reads Chippy.tags at load
require('../../../src/local/ui.js');
const { linkifyPaste } = globalThis.Chippy.ui;

test('URL over a selection becomes [selection](url)', () => {
  assert.equal(linkifyPaste('release notes', 'https://example.com/notes'),
    '[release notes](https://example.com/notes)');
});

test('clipboard whitespace around the URL is trimmed', () => {
  assert.equal(linkifyPaste('docs', '  http://example.com/a?b=1#c \n'),
    '[docs](http://example.com/a?b=1#c)');
});

test('declines when the clipboard is not a single bare URL', () => {
  assert.equal(linkifyPaste('label', 'plain text'), null);
  assert.equal(linkifyPaste('label', 'see https://example.com'), null);
  assert.equal(linkifyPaste('label', '[x](https://example.com)'), null);
  assert.equal(linkifyPaste('label', 'https://a.com\nhttps://b.com'), null);
  assert.equal(linkifyPaste('label', 'ftp://example.com'), null);
  assert.equal(linkifyPaste('label', ''), null);
});

test('declines URLs containing ")" (inline parser stops at first paren)', () => {
  assert.equal(linkifyPaste('label', 'https://en.wikipedia.org/wiki/Foo_(bar)'), null);
});

test('declines empty, multiline or bracketed selections', () => {
  assert.equal(linkifyPaste('', 'https://example.com'), null);
  assert.equal(linkifyPaste('   ', 'https://example.com'), null);
  assert.equal(linkifyPaste('two\nlines', 'https://example.com'), null);
  assert.equal(linkifyPaste('has [brackets]', 'https://example.com'), null);
});
