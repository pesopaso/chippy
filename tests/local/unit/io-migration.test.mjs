// SPDX-License-Identifier: Apache-2.0
//
// Unit tests — io.js system-file loading and the one-time layout migrations:
// pre-v3.1 -> *.chippy.md (v3.1.0-dev.92) and *.chippy.md -> *.sys.chippy.md
// (v3.3.0-dev.37). Runs in Node against a minimal in-memory fake of the File
// System Access directory handle (getFileHandle / createWritable / removeEntry /
// entries), so no browser is needed.

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
    },
    async *entries() {
      for (const name of [...store.keys()]) yield [name, { kind: 'file' }];
    }
  };
}

const SYS = ['names.sys.chippy.md', 'navigation.sys.chippy.md', 'tags.sys.chippy.md'];

const NAV = '# Navigation\n\n> theme: dark\n\n## Discussions\n\n- Alpha\n- Beta | tag: DEV\n';
const TAGS = '# Tags\n\n- career\n- task\n';
const NAMES = '# Names\n\n- Maria Lopez\n';

test('current *.sys.chippy.md layout loads without touching any file', async () => {
  const dir = fakeDir({
    'navigation.sys.chippy.md': NAV,
    'tags.sys.chippy.md': TAGS,
    'names.sys.chippy.md': NAMES
  });
  const { nav, tags, names } = await io.loadIndexes(dir);
  assert.equal(nav.discussions.length, 2);
  assert.deepEqual(tags, ['career', 'task']);
  assert.deepEqual(names, ['Maria Lopez']);
  assert.deepEqual([...dir.files.keys()].sort(), SYS);
});

test('gen-2 *.chippy.md system files are renamed to *.sys.chippy.md (v3.3.0-dev.37)', async () => {
  const dir = fakeDir({
    'navigation.chippy.md': NAV,
    'tags.chippy.md': TAGS,
    'names.chippy.md': NAMES,
    'summary.chippy.md': '# Summary\n'
  });
  const { nav, tags, names } = await io.loadIndexes(dir);
  assert.equal(nav.discussions.length, 2);
  assert.deepEqual(tags, ['career', 'task']);
  assert.deepEqual(names, ['Maria Lopez']);
  assert.deepEqual([...dir.files.keys()].sort(),
    ['names.sys.chippy.md', 'navigation.sys.chippy.md', 'summary.sys.chippy.md', 'tags.sys.chippy.md']);
  assert.equal(dir.files.get('navigation.sys.chippy.md'), NAV); // byte-identical rename
  assert.equal(dir.files.get('summary.sys.chippy.md'), '# Summary\n');
  // and none of the old system names survived to be mistaken for discussions
  assert.equal((await io.listDiscussions(dir)).length, 0);
});

test('gen-2 migration tolerates a missing tags/names file', async () => {
  const dir = fakeDir({ 'navigation.chippy.md': NAV });
  const r = await io.loadIndexes(dir);
  assert.equal(r.nav.discussions.length, 2);
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.names, []);
  assert.deepEqual([...dir.files.keys()], ['navigation.sys.chippy.md']);
});

test('legacy split layout migrates straight to *.sys.chippy.md and removes the old files', async () => {
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
    ['names.sys.chippy.md', 'navigation.sys.chippy.md', 'summary.sys.chippy.md', 'tags.sys.chippy.md']);
  assert.equal(dir.files.get('summary.sys.chippy.md'), '# Summary\n');
  // round-trips through the frozen format
  assert.equal(dir.files.get('navigation.sys.chippy.md'), fmt.serializeNav(nav));
});

test('gen-1 single-file navigation.md (inline sections) chains both migrations', async () => {
  const legacy = '# Navigation\n\n> theme: dark\n\n## Discussions\n\n- Alpha\n\n' +
    '## Tags\n\n- career\n\n## Names\n\n- Maria Lopez\n';
  const dir = fakeDir({ 'navigation.md': legacy });
  const { nav, tags, names } = await io.loadIndexes(dir);
  assert.equal(nav.discussions.length, 1);
  assert.deepEqual(tags, ['career']);
  assert.deepEqual(names, ['Maria Lopez']);
  assert.ok(dir.files.has('navigation.sys.chippy.md'));
  assert.ok(dir.files.has('tags.sys.chippy.md'));
  assert.ok(dir.files.has('names.sys.chippy.md'));
  assert.ok(!dir.files.has('navigation.md'));
});

test('migration drops a polluted "summary" nav entry; sys files win when both exist', async () => {
  const polluted = '# Navigation\n\n> theme: dark\n\n## Discussions\n\n- Alpha\n- summary\n';
  const dir = fakeDir({ 'navigation.md': polluted, 'tags.md': TAGS, 'names.md': NAMES });
  const { nav } = await io.loadIndexes(dir);
  assert.deepEqual(nav.discussions.map(d => d.name), ['Alpha']);

  // when navigation.sys.chippy.md already exists, legacy files are ignored entirely
  // (as system files — the sweep then renames navigation.md as the ordinary
  // discussion it now is)
  const dir2 = fakeDir({
    'navigation.sys.chippy.md': NAV,
    'tags.sys.chippy.md': TAGS,
    'names.sys.chippy.md': NAMES,
    'navigation.md': '# Navigation\n\n## Discussions\n\n- ShouldBeIgnored\n'
  });
  const r2 = await io.loadIndexes(dir2);
  assert.ok(!r2.nav.discussions.some(d => d.name === 'ShouldBeIgnored'));
  assert.ok(dir2.files.has('navigation.chippy.md')); // an ordinary discussion file
  assert.ok(!dir2.files.has('navigation.md'));

  // a gen-2 folder that also holds a legacy "tags.md" discussion-to-be: the
  // system files must move out of *.chippy.md BEFORE the sweep runs, otherwise
  // "tags.chippy.md" would be taken for a discussion named "tags"
  const dir3 = fakeDir({
    'navigation.chippy.md': NAV, 'tags.chippy.md': TAGS, 'names.chippy.md': NAMES,
    'Alpha.md': '# Alpha\n\n## Entries\n'
  });
  await io.loadIndexes(dir3);
  assert.deepEqual([...dir3.files.keys()].sort(),
    ['Alpha.chippy.md', 'names.sys.chippy.md', 'navigation.sys.chippy.md', 'tags.sys.chippy.md']);
  assert.deepEqual(await io.listDiscussions(dir3), ['Alpha']);
});

test('partial legacy set: a missing names.md must not blank the surviving tags.md (and vice versa)', async () => {
  // names.md absent (e.g. unmaterialized cloud placeholder at migration time)
  const dir = fakeDir({ 'navigation.md': NAV, 'tags.md': TAGS });
  const r = await io.loadIndexes(dir);
  assert.deepEqual(r.tags, ['career', 'task']); // preserved from tags.md
  assert.deepEqual(r.names, []);                // nothing to read, but tags survive
  assert.equal(dir.files.get('tags.sys.chippy.md').includes('career'), true);

  // tags.md absent, names.md present
  const dir2 = fakeDir({ 'navigation.md': NAV, 'names.md': NAMES });
  const r2 = await io.loadIndexes(dir2);
  assert.deepEqual(r2.names, ['Maria Lopez']);  // preserved from names.md
  assert.deepEqual(r2.tags, []);
  assert.equal(dir2.files.get('names.sys.chippy.md').includes('Maria Lopez'), true);
});

test('isDiscussionFile: only <stem>.chippy.md; the .sys namespace is reserved', () => {
  for (const f of ['navigation.sys.chippy.md', 'tags.sys.chippy.md', 'names.sys.chippy.md', 'summary.sys.chippy.md']) {
    assert.equal(io.isDiscussionFile(f), false, f);
  }
  // post-migration, the legacy names are valid discussion names again
  for (const f of ['navigation.chippy.md', 'tags.chippy.md', 'names.chippy.md', 'summary.chippy.md', 'Alpha.chippy.md']) {
    assert.equal(io.isDiscussionFile(f), true, f);
  }
  // pre-dev.37 discussion files are migrated, not listed as-is
  assert.equal(io.isDiscussionFile('Alpha.md'), false);
  assert.equal(io.isDiscussionFile('Alpha.archive.chippy.md'), false);
  assert.equal(io.isDiscussionFile('Alpha.archive.md'), false);
  assert.equal(io.isDiscussionFile('Alpha.txt'), false);
});
