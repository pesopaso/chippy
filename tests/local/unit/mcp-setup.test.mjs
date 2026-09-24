// SPDX-License-Identifier: Apache-2.0
//
// scripts/setup-mcp.mjs — installing the MCP server into a Claude Desktop config.
// Pure config transforms plus end-to-end runs against a temp config and folder.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, nodeVersionOk, folderFromAgentMd, desktopConfigPaths, serverEntry,
  parseConfig, withServer, withoutServer, updateConfigFile, isChippyFolder
} from '../../../scripts/setup-mcp.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'setup-mcp.mjs');

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chippy-setup-')); tmpDirs.push(d); return d; }
function notebook() {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'navigation.sys.chippy.md'), '# Navigation\n\n## Discussions\n\n- Dev\n');
  fs.writeFileSync(path.join(d, 'Dev.chippy.md'), '# Dev\n\n## Preparation\n\n\n## Entries\n\n### 2026-09-01 10:00:00 | tags: task\n\nX.\n\n');
  return d;
}

test('parseArgs: options, defaults and rejects', () => {
  const o = parseArgs(['--folder', 'C:\\N', '--read-only', '--claude-code', '-y', '--name', 'chippy-work']);
  assert.deepEqual([o.folder, o.readOnly, o.claudeCode, o.yes, o.name, o.includeSensitive], ['C:\\N', true, true, true, 'chippy-work', false]);
  assert.equal(parseArgs(['--folder=X']).folder, 'X');
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--name', 'a b']), /--name/);
  assert.throws(() => parseArgs(['--folder']), /needs a value/);
});

test('nodeVersionOk and folderFromAgentMd', () => {
  assert.equal(nodeVersionOk('18.12.1'), false);
  assert.equal(nodeVersionOk('18.13.0'), true);
  assert.equal(nodeVersionOk('22.1.0'), true);
  const md = '## Tasks\r\n\r\n- discussion: C:\\Users\\phili\\OneDrive\\pesopaso\\Notebook\\chippy.chippy.md\r\n- tag: dev\r\n';
  assert.equal(folderFromAgentMd(md), 'C:\\Users\\phili\\OneDrive\\pesopaso\\Notebook');
  assert.equal(folderFromAgentMd('- discussion: /home/me/nb/dev.chippy.md'), '/home/me/nb');
  assert.equal(folderFromAgentMd('# nothing'), null);
});

test('desktopConfigPaths per platform, including the Microsoft Store package', () => {
  const home = tmp();
  const local = path.join(home, 'Local');
  fs.mkdirSync(path.join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(local, 'Packages', 'Other_123'), { recursive: true });
  const win = desktopConfigPaths({ APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: local }, 'win32', home);
  assert.deepEqual(win, [
    path.join(home, 'Roaming', 'Claude', 'claude_desktop_config.json'),
    path.join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')
  ]);
  assert.deepEqual(desktopConfigPaths({}, 'darwin', '/Users/me'),
    [path.join('/Users/me', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')]);
});

test('withServer keeps other servers and settings, and reports added/updated/unchanged', () => {
  const entry = serverEntry({ folder: '/nb', readOnly: true }, '/usr/bin/node');
  assert.equal(entry.command, '/usr/bin/node');
  assert.deepEqual(entry.args.slice(1), ['--folder', path.resolve('/nb'), '--read-only']);
  assert.ok(entry.args[0].endsWith(path.join('mcp', 'chippy-mcp.mjs')));

  const cfg = { preferences: { a: 1 }, mcpServers: { other: { command: 'npx', args: ['x'] } } };
  const r1 = withServer(cfg, 'chippy', entry);
  assert.equal(r1.action, 'added');
  assert.deepEqual(r1.config.mcpServers.other, cfg.mcpServers.other);
  assert.deepEqual(r1.config.preferences, { a: 1 });
  assert.equal(cfg.mcpServers.chippy, undefined); // input not mutated
  assert.equal(withServer(r1.config, 'chippy', entry).action, 'unchanged');
  // A user-added "env" survives an update of command/args.
  r1.config.mcpServers.chippy.env = { X: '1' };
  const r3 = withServer(r1.config, 'chippy', serverEntry({ folder: '/other' }, '/usr/bin/node'));
  assert.equal(r3.action, 'updated');
  assert.deepEqual(r3.config.mcpServers.chippy.env, { X: '1' });
  assert.equal(withServer({}, 'chippy', entry).action, 'added');
  assert.throws(() => withServer({ mcpServers: [] }, 'chippy', entry), /not an object/);

  assert.equal(withoutServer(r3.config, 'chippy').action, 'removed');
  assert.equal(withoutServer(r3.config, 'chippy').config.mcpServers.other.command, 'npx');
  assert.equal(withoutServer({}, 'chippy').action, 'absent');
});

test('parseConfig: empty is {}, BOM tolerated, invalid JSON refused', () => {
  assert.deepEqual(parseConfig(null), {});
  assert.deepEqual(parseConfig('  '), {});
  assert.deepEqual(parseConfig('\uFEFF{"a":1}'), { a: 1 });
  assert.throws(() => parseConfig('{bad', 'c.json'), /not valid JSON.*nothing was changed/);
  assert.throws(() => parseConfig('[1]'), /JSON object/);
});

test('updateConfigFile: backup before write, unique backup names, no write when unchanged', () => {
  const d = tmp();
  const f = path.join(d, 'claude_desktop_config.json');
  const entry = serverEntry({ folder: '/nb' }, '/usr/bin/node');
  const now = new Date(2026, 8, 23, 9, 0, 0);
  // Missing file: created, nothing to back up.
  assert.deepEqual(updateConfigFile(f, c => withServer(c, 'chippy', entry), { now }), { action: 'added', backup: null });
  const first = fs.readFileSync(f, 'utf8');
  assert.equal(updateConfigFile(f, c => withServer(c, 'chippy', entry), { now }).action, 'unchanged');
  const r = updateConfigFile(f, c => withoutServer(c, 'chippy'), { now });
  assert.equal(r.action, 'removed');
  assert.ok(r.backup.endsWith('.bak-20260923-090000'));
  assert.equal(fs.readFileSync(r.backup, 'utf8'), first);
  const r2 = updateConfigFile(f, c => withServer(c, 'chippy', entry), { now });
  assert.ok(r2.backup.endsWith('.bak-20260923-090000-2')); // same second: not overwritten
  // Dry run writes nothing.
  const before = fs.readFileSync(f, 'utf8');
  assert.equal(updateConfigFile(f, c => withoutServer(c, 'chippy'), { dryRun: true }).action, 'removed');
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(d).filter(x => x.endsWith('.tmp')), []);
});

test('isChippyFolder', () => {
  assert.equal(isChippyFolder(notebook()), true);
  assert.equal(isChippyFolder(tmp()), false);
  assert.equal(isChippyFolder(path.join(tmp(), 'missing')), false);
});

/* ---------------------------- end to end ------------------------------ */

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('install: smoke-tests the server, then writes the entry; uninstall removes it', () => {
  const nb = notebook();
  const cfgFile = path.join(tmp(), 'claude_desktop_config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  const r = run(['--folder', nb, '--config', cfgFile, '--yes', '--read-only']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Test\s+ok .*1 discussion/);
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  assert.equal(cfg.mcpServers.other.command, 'x');
  assert.equal(cfg.mcpServers.chippy.command, process.execPath);
  assert.deepEqual(cfg.mcpServers.chippy.args.slice(1), ['--folder', nb, '--read-only']);
  assert.ok(fs.existsSync(cfg.mcpServers.chippy.args[0]));

  const u = run(['--uninstall', '--config', cfgFile, '--yes']);
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers), ['other']);
});

test('install refuses a non-Chippy folder and an invalid config, changing nothing', () => {
  const cfgFile = path.join(tmp(), 'c.json');
  const r = run(['--folder', tmp(), '--config', cfgFile, '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a Chippy data folder/);
  assert.equal(fs.existsSync(cfgFile), false);

  fs.writeFileSync(cfgFile, '{bad');
  const r2 = run(['--folder', notebook(), '--config', cfgFile, '--yes', '--skip-test']);
  assert.equal(r2.status, 1);
  assert.equal(fs.readFileSync(cfgFile, 'utf8'), '{bad');
});

test('dry run prints the entry and writes nothing', () => {
  const cfgFile = path.join(tmp(), 'c.json');
  const r = run(['--folder', notebook(), '--config', cfgFile, '--dry-run', '--skip-test']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would be "chippy" added/);
  assert.match(r.stdout, /"mcpServers"/);
  assert.equal(fs.existsSync(cfgFile), false);
});
