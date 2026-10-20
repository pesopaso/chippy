// SPDX-License-Identifier: Apache-2.0
//
// settings.sys.chippy.md — app preferences (datadefinition §3.5): the
// "- <key>: <value>" format, the optional file in io.js, and the store's
// getSetting / setSetting around it (first use: the All Tasks view).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format as fmt, store } from './_load.mjs'; // format.js must load before io.js
import '../../../src/local/io.js';

const io = globalThis.Chippy.io;
const FILE = 'settings.sys.chippy.md';

// In-memory FileSystemDirectoryHandle (root files only).
function fakeDir(files, failing = []) {
  const map = new Map(Object.entries(files));
  const bad = new Set(failing);
  return {
    files: map, name: 'fake',
    async getFileHandle(name, opts) {
      if (!map.has(name)) {
        if (opts && opts.create) map.set(name, '');
        else { const e = new Error(name + ' not found'); e.name = 'NotFoundError'; throw e; }
      }
      return {
        async getFile() {
          if (bad.has(name)) throw new Error('unreadable: ' + name);
          return { async text() { return map.get(name); } };
        },
        async createWritable() {
          let buf = '';
          return { async write(t) { buf += t; }, async close() { map.set(name, buf); } };
        }
      };
    },
    async removeEntry(name) { map.delete(name); },
    async getDirectoryHandle() { throw new Error('no subfolders in this fake'); },
    async *entries() { for (const name of [...map.keys()]) yield [name, { kind: 'file' }]; }
  };
}
const NAV = fmt.serializeNav({ discussions: [] });
async function open(files, failing) {
  const dir = fakeDir(Object.assign({ 'navigation.sys.chippy.md': NAV }, files), failing);
  globalThis.__chippyTest = { dirHandle: dir };
  await store.openFolder();
  return dir;
}

test('the settings file lives in the system namespace', () => {
  assert.equal(io.SETTINGS_FILE, FILE);
  assert.deepEqual(io.classifyFilename(FILE), { kind: 'sys', stem: 'settings' });
  assert.equal(io.isDiscussionFile(FILE), false);
  // "settings" stays free as an ordinary discussion name
  assert.deepEqual(io.classifyFilename('settings.chippy.md'), { kind: 'discussion', stem: 'settings' });
});

test('serializeSettings writes one "- key: value" bullet per setting', () => {
  assert.equal(fmt.serializeSettings({ 'all-tasks-view': 'kanban' }), '# Settings\n\n- all-tasks-view: kanban\n');
  assert.equal(fmt.serializeSettings({}), '# Settings\n\n');
  // empty values, malformed keys and line breaks never reach the file
  assert.equal(
    fmt.serializeSettings({ 'all-tasks-view': 'list', empty: '', 'Bad Key': 'x', note: 'a\nb' }),
    '# Settings\n\n- all-tasks-view: list\n- note: a b\n');
});

test('parseSettings reads the pairs, keeps unknown keys and ignores everything else', () => {
  const md = '# Settings\n\nsome prose\n- all-tasks-view: kanban\n- future-thing: on: yes\n- not a setting\n- Upper: x\n- blank: \n';
  assert.deepEqual(fmt.parseSettings(md), { 'all-tasks-view': 'kanban', 'future-thing': 'on: yes' });
  assert.deepEqual(fmt.parseSettings(''), {});
  // CRLF input (edited on Windows) and a repeated key: the last line wins
  assert.deepEqual(fmt.parseSettings('# Settings\r\n\r\n- all-tasks-view: list\r\n- all-tasks-view: kanban\r\n'),
    { 'all-tasks-view': 'kanban' });
});

test('settings round-trip, unknown keys included', () => {
  const s = { 'all-tasks-view': 'kanban', 'future-thing': 'on' };
  assert.deepEqual(fmt.parseSettings(fmt.serializeSettings(s)), s);
});

test('io.loadSettings: absent file means defaults; saveSettings creates it', async () => {
  const dir = fakeDir({});
  assert.deepEqual(await io.loadSettings(dir), {});
  assert.equal(dir.files.has(FILE), false, 'reading never creates the file');
  await io.saveSettings(dir, { 'all-tasks-view': 'kanban' });
  assert.equal(dir.files.get(FILE), '# Settings\n\n- all-tasks-view: kanban\n');
  assert.deepEqual(await io.loadSettings(dir), { 'all-tasks-view': 'kanban' });
});

test('opening a folder without a settings file gives defaults and writes nothing', async () => {
  const dir = await open({});
  assert.equal(store.getSetting('all-tasks-view', 'list'), 'list');
  assert.equal(store.getSetting('all-tasks-view'), undefined);
  assert.equal(dir.files.has(FILE), false);
});

test('opening a folder loads the saved view', async () => {
  await open({ [FILE]: '# Settings\n\n- all-tasks-view: kanban\n' });
  assert.equal(store.getSetting('all-tasks-view', 'list'), 'kanban');
});

test('setSetting saves to the file, emits, and keeps other keys', async () => {
  const dir = await open({ [FILE]: '# Settings\n\n- future-thing: on\n' });
  const events = [];
  const un = store.subscribe(cs => { if (cs.type === 'settingChanged') events.push(cs); });
  const p = store.setSetting('all-tasks-view', 'kanban');
  assert.equal(store.getSetting('all-tasks-view', 'list'), 'kanban', 'in memory before the write finishes');
  await p;
  assert.equal(dir.files.get(FILE), '# Settings\n\n- future-thing: on\n- all-tasks-view: kanban\n');
  assert.deepEqual(events, [{ type: 'settingChanged', key: 'all-tasks-view', value: 'kanban' }]);

  // same value again: no write, no event
  dir.files.set(FILE, 'sentinel');
  await store.setSetting('all-tasks-view', 'kanban');
  assert.equal(dir.files.get(FILE), 'sentinel');
  assert.equal(events.length, 1);

  await store.setSetting('all-tasks-view', 'list');
  un();
  assert.equal(dir.files.get(FILE), '# Settings\n\n- future-thing: on\n- all-tasks-view: list\n');
});

test('each folder has its own settings; reloadFolder re-reads them', async () => {
  await open({ [FILE]: '# Settings\n\n- all-tasks-view: kanban\n' });
  const dir = await open({});                       // a different folder, no file
  assert.equal(store.getSetting('all-tasks-view', 'list'), 'list');
  dir.files.set(FILE, '# Settings\n\n- all-tasks-view: kanban\n'); // changed outside Chippy
  await store.reloadFolder();
  assert.equal(store.getSetting('all-tasks-view', 'list'), 'kanban');
});

test('an unreadable settings file does not block opening the folder', async () => {
  const errors = [];
  const orig = console.error; console.error = (...a) => errors.push(a);
  try {
    await open({ [FILE]: '# Settings\n\n- all-tasks-view: kanban\n' }, [FILE]);
  } finally { console.error = orig; }
  assert.equal(store._state.folderReady, true);
  assert.equal(store.getSetting('all-tasks-view', 'list'), 'list');
  assert.equal(errors.length, 1);
});

test('getSetting ignores inherited object properties', async () => {
  await open({});
  assert.equal(store.getSetting('constructor', 'fallback'), 'fallback');
});
