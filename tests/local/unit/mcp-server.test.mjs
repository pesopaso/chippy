// SPDX-License-Identifier: Apache-2.0
//
// MCP server (mcp/) — JSON-RPC dispatch and tools against a real temp folder.
// The server runs the unchanged io.js/store.js through the node-fs-access.mjs
// shim, so these tests also pin that the shim is a faithful enough folder
// handle for the app's own persistence code.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Deterministic clock for store.nowISO (the app's test seam).
globalThis.__chippyTest = { now: () => new Date(2026, 8, 22, 10, 30, 0) };
const { createChippyServer, PROTOCOL_VERSIONS } = await import('../../../mcp/chippy-tools.mjs');

const disc = (name, entries) => '# ' + name + '\n\n## Preparation\n\n\n## Entries\n\n' +
  entries.map(([h, b]) => '### ' + h + '\n\n' + b + '\n\n').join('');

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function seedFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chippy-mcp-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'navigation.sys.chippy.md'),
    '# Navigation\n\n## Discussions\n\n- Dev | tag: Work\n- Maria Lopez\n- Project\n- Private | sensitive\n');
  fs.writeFileSync(path.join(dir, 'tags.sys.chippy.md'), '# Tags\n\n- dev\n- task\n');
  fs.writeFileSync(path.join(dir, 'names.sys.chippy.md'), '# Names\n\n');
  fs.writeFileSync(path.join(dir, 'Dev.chippy.md'), disc('Dev', [
    ['2026-09-01 10:00 | tags: task, dev, high', 'Fix login bug.'],
    ['2026-09-01 10:00 | tags: idea, low', 'Print stylesheet.'],
    ['2026-09-02 09:00:00 | tags: sensitive', 'Secret note.'],
    ['2026-09-03 09:00:00 | tags: task, dev, low, resolvedtask', 'Old done task.'],
    ['2026-09-04 09:00:00 | tags: idea, exploredidea, medium', 'Kanban swimlanes.']
  ]));
  fs.writeFileSync(path.join(dir, 'Maria Lopez.chippy.md'), disc('Maria Lopez', [
    ['2026-08-18 10:30:00 | tags: task, high, Maria Lopez:link-k7f2a', 'Coordinate the vendor review.']
  ]));
  fs.writeFileSync(path.join(dir, 'Project.chippy.md'), disc('Project', [
    ['2026-08-18 14:05:00 | tags: task, Maria Lopez:link-k7f2a', 'Coordinate the vendor review.']
  ]));
  fs.writeFileSync(path.join(dir, 'Private.chippy.md'), disc('Private', [
    ['2026-09-05 10:00:00 | tags: task, dev', 'Private task.']
  ]));
  return dir;
}

const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

async function call(server, name, args) {
  const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  assert.ok(res.result, 'tools/call returns a result');
  return res.result;
}
async function ok(server, name, args) {
  const r = await call(server, name, args);
  assert.ok(!r.isError, name + ' failed: ' + (r.content && r.content[0].text));
  return r.structuredContent;
}
async function err(server, name, args) {
  const r = await call(server, name, args);
  assert.equal(r.isError, true, name + ' should fail');
  return r.content[0].text;
}

/* ------------------------------ protocol ------------------------------- */

test('initialize negotiates the protocol version and announces tools', async () => {
  const s = createChippyServer({ folder: seedFolder(), log: () => {} });
  const r = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } });
  assert.equal(r.result.protocolVersion, '2025-03-26');
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.result.serverInfo.name, 'chippy');
  assert.match(r.result.serverInfo.version, /^\d+\.\d+\.\d+/);
  const r2 = await s.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(r2.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('notifications get no answer; unknown methods and tools are JSON-RPC errors', async () => {
  const s = createChippyServer({ folder: seedFolder(), log: () => {} });
  assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepEqual((await s.handle({ jsonrpc: '2.0', id: 7, method: 'ping' })).result, {});
  assert.equal((await s.handle({ jsonrpc: '2.0', id: 8, method: 'resources/list' })).error.code, -32601);
  assert.equal((await s.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } })).error.code, -32602);
  assert.equal((await s.handle({ id: 10, method: 'ping' })).error.code, -32600);
});

test('tools/list: all tools, and --read-only hides every write tool', async () => {
  const s = createChippyServer({ folder: seedFolder(), log: () => {} });
  const names = (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map(t => t.name);
  assert.deepEqual(names, ['list_discussions', 'read_discussion', 'search_entries', 'add_entry', 'set_state',
    'append_action', 'update_entry', 'promote_idea', 'create_discussion']);
  const ro = createChippyServer({ folder: seedFolder(), readOnly: true, log: () => {} });
  const tools = (await ro.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  assert.deepEqual(tools.map(t => t.name), ['list_discussions', 'read_discussion', 'search_entries']);
  assert.ok(tools.every(t => t.annotations.readOnlyHint === true));
  assert.equal((await ro.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'add_entry', arguments: {} } })).error.code, -32602);
});

test('refuses a folder Chippy has never opened, and does not touch it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chippy-mcp-empty-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'readme.md'), 'not a notebook');
  const s = createChippyServer({ folder: dir, log: () => {} });
  assert.match(await err(s, 'list_discussions', {}), /Not a Chippy data folder/);
  assert.deepEqual(fs.readdirSync(dir), ['readme.md']);
});

/* ------------------------------- reading -------------------------------- */

test('list_discussions and search_entries hide sensitive data by default', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  const list = (await ok(s, 'list_discussions', {})).discussions;
  assert.deepEqual(list.map(d => d.name), ['Dev', 'Maria Lopez', 'Project']);
  const dev = list.find(d => d.name === 'Dev');
  assert.equal(dev.group, 'Work');
  assert.equal(dev.entries, 4);                 // the sensitive entry is not counted
  assert.equal(dev.open_tasks, 1);
  assert.equal(dev.open_ideas, 2);
  assert.equal(dev.last_entry, '2026-09-04 09:00:00');
  assert.equal(list.find(d => d.name === 'Project').entries, 0); // references are not counted twice

  const found = await ok(s, 'search_entries', { query: 'secret' });
  assert.equal(found.total, 0);
  assert.match(await err(s, 'read_discussion', { discussion: 'Private' }), /sensitive/);

  const all = createChippyServer({ folder: dir, includeSensitive: true, log: () => {} });
  assert.equal((await ok(all, 'search_entries', { query: 'secret' })).total, 1);
  assert.equal((await ok(all, 'read_discussion', { discussion: 'private' })).entries.length, 1);
});

test('search_entries: Chippy query syntax, open filter and priority order', async () => {
  const s = createChippyServer({ folder: seedFolder(), log: () => {} });
  const r = await ok(s, 'search_entries', { query: '#dev', open_only: true, sort: 'priority' });
  assert.deepEqual(r.entries.map(e => e.text), ['Fix login bug.']);
  const tasks = await ok(s, 'search_entries', { type: 'task', open_only: true, sort: 'priority' });
  // The linked task is listed once — at its origin — and HI sorts first.
  assert.deepEqual(tasks.entries.map(e => [e.discussion, e.priority]), [['Maria Lopez', 'HI'], ['Dev', 'HI']]);
  const ideas = await ok(s, 'search_entries', { type: 'idea', state: 'Explored' });
  assert.deepEqual(ideas.entries.map(e => e.text), ['Kanban swimlanes.']);
});

test('read_discussion reports state, priority, links and addresses entries by created_at + idx', async () => {
  const s = createChippyServer({ folder: seedFolder(), log: () => {} });
  const r = await ok(s, 'read_discussion', { discussion: 'dev', include_closed: false });
  assert.equal(r.discussion, 'Dev');
  assert.deepEqual(r.entries.map(e => [e.idx, e.type, e.state, e.priority]),
    [[0, 'task', 'OPEN', 'HI'], [1, 'idea', 'Considered', 'LO'], [4, 'idea', 'Explored', 'MI']]);
  assert.deepEqual(r.entries[0].tags, ['dev']);   // reserved tags are not listed
  const p = await ok(s, 'read_discussion', { discussion: 'Project' });
  assert.equal(p.entries[0].reference_to, 'Maria Lopez');
});

test('outside edits are picked up on the next call', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  assert.equal((await ok(s, 'read_discussion', { discussion: 'Maria Lopez' })).entries.length, 1);
  fs.appendFileSync(path.join(dir, 'Maria Lopez.chippy.md'), '### 2026-09-10 08:00:00 | tags: career\n\nAdded by the app.\n\n');
  fs.writeFileSync(path.join(dir, 'New One.chippy.md'), disc('New One', [['2026-09-10 09:00:00', 'Hello.']]));
  assert.equal((await ok(s, 'read_discussion', { discussion: 'Maria Lopez' })).entries.length, 2);
  assert.ok((await ok(s, 'list_discussions', {})).discussions.some(d => d.name === 'New One'));
});

/* ------------------------------- writing -------------------------------- */

test('set_state needs idx for a shared created_at, then logs the transition like the app', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  assert.match(await err(s, 'set_state', { discussion: 'Dev', created_at: '2026-09-01 10:00', state: 'WIP' }), /pass idx/);
  const r = await ok(s, 'set_state', { discussion: 'Dev', created_at: '2026-09-01 10:00', idx: 0, state: 'wip' });
  assert.equal(r.updated.state, 'WIP');
  assert.deepEqual(r.updated.actions, ['2026-09-22 : → WIP']);
  const md = read(dir, 'Dev.chippy.md');
  assert.match(md, /### 2026-09-01 10:00 \| tags: task, dev, high, inprogresstask\n\nFix login bug\.\n\nTask Resolution Actions\n- 2026-09-22 : → WIP\n/);
  assert.match(md, /### 2026-09-01 10:00 \| tags: idea, low\n\nPrint stylesheet\./); // its twin is untouched
  assert.match(await err(s, 'set_state', { discussion: 'Dev', created_at: '2026-09-02 09:00:00', state: 'DONE' }), /sensitive/);
  assert.match(await err(s, 'set_state', { discussion: 'Dev', created_at: '2026-09-04 09:00:00', state: 'Promoted' }), /promote_idea/);
});

test('add_entry applies the write rules and updates the indexes', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  const r = await ok(s, 'add_entry', { discussion: 'Dev', text: 'Write MCP docs with @[Anna Wehrli]', kind: 'task',
    tags: ['#Docs'], priority: 'medium', due: '2026-10-01', state: 'HOLD' });
  assert.deepEqual([r.created.created_at, r.created.state, r.created.priority, r.created.due, r.created.idx],
    ['2026-09-22 10:30:00', 'HOLD', 'MI', '2026-10-01', 5]);
  assert.match(read(dir, 'Dev.chippy.md'),
    /### 2026-09-22 10:30:00 \| tags: task, docs, medium, onholdtask \| due: 2026-10-01\n\nWrite MCP docs with @\[Anna Wehrli\]\n\nTask Resolution Actions\n- 2026-09-22 : → HOLD\n/);
  assert.match(read(dir, 'tags.sys.chippy.md'), /- docs\n/);
  assert.match(read(dir, 'names.sys.chippy.md'), /- Anna Wehrli\n/);
  // A plain task without priority defaults to LO; reserved tags are refused.
  assert.equal((await ok(s, 'add_entry', { discussion: 'Dev', text: 'Another', kind: 'task' })).created.priority, 'LO');
  assert.match(await err(s, 'add_entry', { discussion: 'Dev', text: 'x', tags: ['resolvedtask'] }), /reserved/);
  assert.match(await err(s, 'add_entry', { discussion: 'Nowhere', text: 'x' }), /No discussion named/);
  assert.match(await err(s, 'add_entry', { discussion: 'Dev', text: 'x', due: 'tomorrow' }), /YYYY-MM-DD/);
});

test('append_action and update_entry keep the three-part body intact', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  await ok(s, 'append_action', { discussion: 'Dev', created_at: '2026-09-04 09:00:00', text: 'Sketched\nthe lanes.' });
  const r = await ok(s, 'update_entry', { discussion: 'Dev', created_at: '2026-09-04 09:00:00',
    text: 'Kanban swimlanes per discussion.', priority: 'high', due: '2026-12-01', add_tags: ['ui'] });
  assert.equal(r.updated.priority, 'HI');
  assert.equal(r.updated.due, '2026-12-01');
  assert.deepEqual(r.updated.tags, ['ui']);
  assert.equal(r.updated.updated, '2026-09-22 10:30:00');
  assert.match(read(dir, 'Dev.chippy.md'),
    /### 2026-09-04 09:00:00 \| tags: idea, exploredidea, ui, high \| due: 2026-12-01\n\nKanban swimlanes per discussion\.\n\nUpdated: 2026-09-22 10:30:00\n\nIdea Actions\n- 2026-09-22 : Sketched the lanes\.\n/);
  const cleared = await ok(s, 'update_entry', { discussion: 'Dev', created_at: '2026-09-04 09:00:00', due: null, remove_tags: ['ui'] });
  assert.equal(cleared.updated.due, null);
  assert.deepEqual(cleared.updated.tags, []);
});

test('promote_idea follows the idea lifecycle rules', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  assert.match(await err(s, 'promote_idea', { discussion: 'Dev', created_at: '2026-09-01 10:00', idx: 1, kind: 'task' }), /Explored or Promoted/);
  assert.match(await err(s, 'promote_idea', { discussion: 'Dev', created_at: '2026-09-04 09:00:00', kind: 'goal' }), /only be created from Promoted/);
  const r = await ok(s, 'promote_idea', { discussion: 'Dev', created_at: '2026-09-04 09:00:00', kind: 'task', title: 'Build swimlanes' });
  assert.equal(r.idea.state, 'Promoted');
  assert.deepEqual([r.created.type, r.created.state, r.created.text], ['task', 'OPEN', 'Build swimlanes']);
  assert.deepEqual(r.created.actions, ['2026-09-22 : Derived from idea: Kanban swimlanes.']);
  assert.match(read(dir, 'Dev.chippy.md'), /promoteditea/);
});

test('writes through a linked reference change the origin entry', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  const r = await ok(s, 'set_state', { discussion: 'Project', created_at: '2026-08-18 14:05:00', state: 'DONE' });
  assert.equal(r.updated.discussion, 'Maria Lopez');
  assert.match(read(dir, 'Maria Lopez.chippy.md'), /tags: task, high, Maria Lopez:link-k7f2a, resolvedtask/);
  assert.doesNotMatch(read(dir, 'Project.chippy.md'), /resolvedtask|Actions/);
});

test('create_discussion writes the file and the navigation entry', async () => {
  const dir = seedFolder();
  const s = createChippyServer({ folder: dir, log: () => {} });
  assert.deepEqual(await ok(s, 'create_discussion', { name: 'R&D' }), { created: 'R&D', file: 'RD.chippy.md' });
  assert.ok(fs.existsSync(path.join(dir, 'RD.chippy.md')));
  assert.match(read(dir, 'navigation.sys.chippy.md'), /- R&D\n/);
  assert.equal((await ok(s, 'create_discussion', { name: 'Dev' })).created, 'Dev_2');
  // The shim leaves no temp files behind.
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

/* ------------------------------- stdio ---------------------------------- */

test('stdio: newline-delimited JSON-RPC on stdout, logs on stderr', async () => {
  const dir = seedFolder();
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp', 'chippy-mcp.mjs'), '--folder', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', errOut = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { errOut += d; });
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_discussions', arguments: {} } }
  ];
  child.stdin.write(msgs.map(m => JSON.stringify(m)).join('\n') + '\nnot json\n');
  child.stdin.end();
  const code = await new Promise(res => child.on('close', res));
  assert.equal(code, 0, errOut);
  const lines = out.trim().split('\n').map(l => JSON.parse(l)); // every stdout line is JSON
  const byId = new Map(lines.map(l => [l.id, l]));
  assert.equal(byId.get(1).result.serverInfo.name, 'chippy');
  assert.equal(byId.get(2).result.structuredContent.discussions.length, 3);
  assert.equal(byId.get(null).error.code, -32700);
  assert.match(errOut, /serving/);
});
