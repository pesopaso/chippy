// SPDX-License-Identifier: Apache-2.0
//
// Unit tests — io.js index loading and the one-time *.chippy.md migration
// (v3.3). Runs in Node against a minimal in-memory fake of the File System
// Access directory handle: io.js only touches getFileHandle / createWritable /
// removeEntry on the index paths, so no browser is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../../../src/local/format.js'; // io.js builds on Chippy.format
import '../../../src/local/io.js';

const io = globalThis.Chippy.io;
const fmt = globalThis.Chippy.format;

// Minimal FSA fake over a name -> text map.
function fakeDir(files) {
  const store = new Map(Object.entries(files));
  return {
    files: store,
    async getFileHandle(name, opts) {
      if (!store.has(name)) {
        if (opts && opts.create) store.set(name, '');
        else { const e = new Error(name + ' not found'); e.name = 'NotFoundError'; throw e; }
      }
      return {
        async getFile() { return { async text() { return store.get(name); } }; },
        async createWritable() {
          let buf = '';
          return {
            async write(t) { buf += t; },
            async close() { store.set(name, buf); }
          };
        }
      };
    },
    async removeEntry(name) {
      if (!store.delete(name)) { const e = new Error(name + ' not found'); e.name = 'NotFoundError'; throw e; }
    }
  };
}

const NAV = '# Navigation\n\n> theme: dark\n\n## Discussions\n\n- Alpha\n- Beta | tag: DEV\n';
const TAGS = '# Tags\n\n- career\n- task\n';
const NAMES = '# Names\n\n- Maria Lopez\n';

test('current .chippy.md layout loads without touching any file', async () => {
  const dir = fakeDir({
    'navigation.chippy.md': NAV,
    'tags.chippy.md': TAGS,
    'names.chippy.md': NAMES
  });
  const { nav, tags, names } = await io.loadIndexes(dir);
  assert.equal(nav.discussions.length, 2);
  assert.deepEqual(tags, ['career', 'task']);
  assert.deepEqual(names, ['Maria Lopez']);
  assert.deepEqual([...dir.files.keys()].sort(),
    ['names.chippy.md', 'navigation.chippy.md', 'tags.chippy.md']);
});

test('legacy split layout migrates to *.chippy.md and removes the old files', async () => {
  const dir = fakeDir({
    'navigation.md': NAV,
    'tags.md': TAGS,
    'names.md': NAMES,
    'summary.md': '# Summary\n'
  });
  const { nav, tags, names } = await io.loadIndexes(dir);
  assert.equal(nav.discussions.length, 2);
  assert.deepEqual(tags, ['career', 'task']);
  assert.deepEqual(names, ['Maria Lopez']);
  // new files written, legacy files gone (effectively a rename)
  assert.deepEqual([...dir.files.keys()].sort(),
    ['names.chippy.md', 'navigation.chippy.md', 'summary.chippy.md', 'tags.chippy.md']);
  assert.equal(dir.files.get('summary.chippy.md'), '# Summary\n');
  // round-trips through the frozen format
  assert.equal(dir.files.get('navigation.chippy.md'), fmt.serializeNav(nav));
});

test('gen-1 single-file navigation.md (inline sections) chains both migrations', async () => {
  const legacy = '# Navigation\n\n> theme: dark\n\n## Discussions\n\n- Alpha\n\n' +
    '## Tags\n\n- career\n\n## Names\n\n- Maria Lopez\n';
  const dir = fakeDir({ 'navigation.md': legacy });
  const { nav, tags, names } = await io.loadIndexes(dir);
  assert.equal(nav.discussions.length, 1);
  assert.deepEqual(tags, ['career']);
  assert.deepEqual(names, ['Maria Lopez']);
  assert.ok(dir.files.has('navigation.chippy.md'));
  assert.ok(dir.files.has('tags.chippy.md'));
  assert.ok(dir.files.has('names.chippy.md'));
  assert.ok(!dir.files.has('navigation.md'));
});

test('migration drops a polluted "summary" nav entry; chippy files win when both exist', async () => {
  const polluted = '# Navigation\n\n> theme: dark\n\n## Discussions\n\n- Alpha\n- summary\n';
  const dir = fakeDir({ 'navigation.md': polluted, 'tags.md': TAGS, 'names.md': NAMES });
  const { nav } = await io.loadIndexes(dir);
  assert.deepEqual(nav.discussions.map(d => d.name), ['Alpha']);

  // when navigation.chippy.md already exists, legacy files are ignored entirely
  const dir2 = fakeDir({
    'navigation.chippy.md': NAV,
    'tags.chippy.md': TAGS,
    'names.chippy.md': NAMES,
    'navigation.md': '# Navigation\n\n## Discussions\n\n- ShouldBeIgnored\n'
  });
  const r2 = await io.loadIndexes(dir2);
  assert.ok(!r2.nav.discussions.some(d => d.name === 'ShouldBeIgnored'));
  assert.ok(dir2.files.has('navigation.md')); // untouched, now an ordinary file
});

test('isDiscussionFile: .chippy.md namespace is reserved, legacy names are ordinary', () => {
  for (const f of ['navigation.chippy.md', 'tags.chippy.md', 'names.chippy.md', 'summary.chippy.md']) {
    assert.equal(io.isDiscussionFile(f), false, f);
  }
  // post-migration, the legacy names are valid discussion names again
  for (const f of ['navigation.md', 'tags.md', 'names.md', 'summary.md', 'Alpha.md']) {
    assert.equal(io.isDiscussionFile(f), true, f);
  }
  assert.equal(io.isDiscussionFile('Alpha.archive.md'), false);
  assert.equal(io.isDiscussionFile('Alpha.txt'), false);
});
