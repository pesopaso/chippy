// SPDX-License-Identifier: Apache-2.0
//
// setup-mcp.mjs — install (or remove) the Chippy MCP server in Claude.
//
// What it does, in order:
//   1. checks Node.js (>= 18.13) and finds the notebook folder
//      (--folder, CHIPPY_NOTEBOOK, the folder of the discussion bound in agent.md,
//      or a prompt);
//   2. smoke-tests the server against that folder: a real stdio initialize +
//      list_discussions round trip, read-only;
//   3. adds/updates the "chippy" entry in Claude Desktop's
//      claude_desktop_config.json — other servers and settings are kept, a
//      timestamped backup is written first, invalid JSON is never overwritten;
//   4. with --claude-code, also registers it in Claude Code (`claude mcp add`).
//
// Usage:
//   node scripts/setup-mcp.mjs [--folder <path>] [--read-only] [--include-sensitive]
//                              [--claude-code] [--name chippy] [--yes] [--dry-run]
//   node scripts/setup-mcp.mjs --uninstall [--claude-code]
//   npm run mcp:setup -- <options>        or double-click mcp\install.cmd
//
//   --config <file>   write this config file instead of Claude Desktop's (tests)
//   --skip-test       skip the smoke test
//
// Exit codes: 0 ok / nothing to do; 1 error; 2 cancelled by the user.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'mcp', 'chippy-mcp.mjs');
const NAV_FILES = ['navigation.sys.chippy.md', 'navigation.chippy.md', 'navigation.md'];
const MIN_NODE = [18, 13];

/* ------------------------------ pure helpers ---------------------------- */

export function parseArgs(argv) {
  const o = { folder: null, readOnly: false, includeSensitive: false, claudeCode: false, name: 'chippy',
    yes: false, dryRun: false, uninstall: false, config: null, skipTest: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null) throw new Error(a + ' needs a value'); return v; };
    if (a === '--folder') o.folder = val();
    else if (a.startsWith('--folder=')) o.folder = a.slice(9);
    else if (a === '--read-only') o.readOnly = true;
    else if (a === '--include-sensitive') o.includeSensitive = true;
    else if (a === '--claude-code') o.claudeCode = true;
    else if (a === '--name') o.name = val();
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--uninstall') o.uninstall = true;
    else if (a === '--config') o.config = val();
    else if (a === '--skip-test') o.skipTest = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('Unknown option: ' + a);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(o.name)) throw new Error('--name may only contain letters, digits, _ and -');
  return o;
}

export function nodeVersionOk(version = process.versions.node) {
  const [maj, min] = version.split('.').map(Number);
  return maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1]);
}

export function isChippyFolder(dir) {
  try { return fs.statSync(dir).isDirectory() && NAV_FILES.some(f => fs.existsSync(path.join(dir, f))); }
  catch (_) { return false; }
}

// The notebook folder of the first discussion bound in agent.md ("- discussion: <path>").
export function folderFromAgentMd(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^- discussion:\s*(.+?)\s*$/);
    if (m) return path.win32.isAbsolute(m[1]) && m[1].includes('\\') ? path.win32.dirname(m[1]) : path.dirname(m[1]);
  }
  return null;
}

// Claude Desktop config files: the standard location, plus the Microsoft Store
// (MSIX) package's redirected AppData when that package is installed.
export function desktopConfigPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') {
    const out = [];
    const appdata = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    out.push(path.join(appdata, 'Claude', 'claude_desktop_config.json'));
    const pkgs = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
    try {
      for (const d of fs.readdirSync(pkgs)) {
        if (!/^Claude_/i.test(d)) continue;
        const dir = path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude');
        if (fs.existsSync(dir)) out.push(path.join(dir, 'claude_desktop_config.json'));
      }
    } catch (_) { /* no Packages folder */ }
    return out;
  }
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
  return [path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json')];
}

// The server's launch arguments (absolute paths: Claude does not start it in the repo).
export function serverArgs(o) {
  const args = [SERVER, '--folder', path.resolve(o.folder)];
  if (o.readOnly) args.push('--read-only');
  if (o.includeSensitive) args.push('--include-sensitive');
  return args;
}

export function serverEntry(o, nodePath = process.execPath) {
  return { command: nodePath, args: serverArgs(o) };
}

// Parse an existing config. Missing/empty -> {}. Invalid JSON -> throws (never clobber it).
export function parseConfig(text, file) {
  if (text == null || !String(text).trim()) return {};
  let cfg;
  try { cfg = JSON.parse(String(text).replace(/^﻿/, '')); }
  catch (err) { throw new Error((file || 'config') + ' is not valid JSON (' + err.message + '). Fix or remove it first; nothing was changed.'); }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error((file || 'config') + ' does not contain a JSON object; nothing was changed.');
  return cfg;
}

// Pure: returns { config, action } with action 'added' | 'updated' | 'unchanged'.
export function withServer(cfg, name, entry) {
  const out = JSON.parse(JSON.stringify(cfg || {}));
  if (out.mcpServers != null && (typeof out.mcpServers !== 'object' || Array.isArray(out.mcpServers))) {
    throw new Error('"mcpServers" in the config is not an object; nothing was changed.');
  }
  out.mcpServers = out.mcpServers || {};
  const prev = out.mcpServers[name];
  // Keep any extra keys the user added to the entry (e.g. "env"); ours win for command/args.
  out.mcpServers[name] = Object.assign({}, prev && typeof prev === 'object' ? prev : {}, entry);
  const action = !prev ? 'added' : JSON.stringify(prev) === JSON.stringify(out.mcpServers[name]) ? 'unchanged' : 'updated';
  return { config: out, action };
}

// Pure: returns { config, action } with action 'removed' | 'absent'.
export function withoutServer(cfg, name) {
  const out = JSON.parse(JSON.stringify(cfg || {}));
  if (!out.mcpServers || !(name in out.mcpServers)) return { config: out, action: 'absent' };
  delete out.mcpServers[name];
  return { config: out, action: 'removed' };
}

export function backupName(file, d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return file + '.bak-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/* ------------------------------ side effects ---------------------------- */

// Start the real server read-only and do initialize + list_discussions.
// Resolves to { discussions } or rejects with a readable message.
export function smokeTest(folder, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--folder', path.resolve(folder), '--read-only'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', errOut = '', done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); child.kill(); fn(v); };
    const timer = setTimeout(() => finish(reject, new Error('the server did not answer within ' + timeoutMs / 1000 + ' s')), timeoutMs);
    child.stderr.on('data', d => { errOut += d; });
    child.on('error', e => finish(reject, e));
    child.on('close', code => finish(reject, new Error('the server exited (code ' + code + ')' + (errOut ? ':\n' + errOut.trim() : ''))));
    child.stdout.on('data', d => {
      out += d;
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl); out = out.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch (_) { return finish(reject, new Error('the server wrote non-JSON to stdout: ' + line.slice(0, 120))); }
        if (msg.id === 1) {
          if (!msg.result || msg.result.serverInfo?.name !== 'chippy') return finish(reject, new Error('unexpected initialize answer'));
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_discussions', arguments: {} } }) + '\n');
        } else if (msg.id === 2) {
          const r = msg.result || {};
          if (r.isError) return finish(reject, new Error(r.content?.[0]?.text || 'list_discussions failed'));
          return finish(resolve, { discussions: (r.structuredContent?.discussions || []).length });
        }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chippy-setup', version: '1' } } }) + '\n');
  });
}

function readIfExists(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// Apply a pure config transform to one file: backup, then write. Returns the action.
export function updateConfigFile(file, transform, { dryRun = false, now = new Date() } = {}) {
  const text = readIfExists(file);
  const { config, action } = transform(parseConfig(text, file));
  if (action === 'unchanged' || action === 'absent' || dryRun) return { action, backup: null };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (text != null) {
    // Never overwrite an earlier backup (two runs within the same second).
    const base = backupName(file, now);
    backup = base;
    for (let n = 2; fs.existsSync(backup); n++) backup = base + '-' + n;
    fs.writeFileSync(backup, text);
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return { action, backup };
}

function claudeCli(args) {
  // claude is a .cmd shim on Windows, which needs a shell to run.
  return spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32' });
}

function registerClaudeCode(o, { uninstall }) {
  const probe = claudeCli(['--version']);
  if (probe.error || probe.status !== 0) return { ok: false, message: 'Claude Code CLI ("claude") not found on PATH — skipped.' };
  claudeCli(['mcp', 'remove', o.name, '--scope', 'user']); // ignore "not found"
  if (uninstall) return { ok: true, message: 'removed from Claude Code (user scope)' };
  const quote = s => (process.platform === 'win32' && /\s/.test(s) ? '"' + s + '"' : s);
  const r = claudeCli(['mcp', 'add', o.name, '--scope', 'user', '--', quote(process.execPath), ...serverArgs(o).map(quote)]);
  if (r.status !== 0) return { ok: false, message: 'claude mcp add failed: ' + (r.stderr || r.stdout || '').trim() };
  return { ok: true, message: 'registered in Claude Code (user scope)' };
}

/* ---------------------------------- main -------------------------------- */

const HELP = `Install the Chippy MCP server in Claude Desktop (and optionally Claude Code).

  node scripts/setup-mcp.mjs [options]

  --folder <path>        notebook folder (default: CHIPPY_NOTEBOOK, else agent.md, else asked)
  --read-only            offer only the read tools
  --include-sensitive    also expose sensitive entries/discussions
  --claude-code          also register in Claude Code (claude mcp add, user scope)
  --name <name>          server name in the config (default: chippy)
  --uninstall            remove the server instead
  --yes, -y              do not ask for confirmation
  --dry-run              show what would change, write nothing
  --skip-test            skip the server smoke test
  --config <file>        use this config file instead of Claude Desktop's
`;

async function ask(rl, q, def) {
  if (!rl) return def;
  const a = (await rl.question(q)).trim();
  return a || def;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message + '\n\n' + HELP); return 1; }
  if (o.help) { console.log(HELP); return 0; }

  const interactive = process.stdin.isTTY && !o.yes;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    console.log('\nChippy MCP server ' + (o.uninstall ? 'removal' : 'setup') + '\n');

    if (!nodeVersionOk()) {
      console.error('Node.js ' + MIN_NODE.join('.') + ' or later is required (this is ' + process.versions.node + '). Get it from https://nodejs.org');
      return 1;
    }
    console.log('  Node.js    ' + process.versions.node + '  (' + process.execPath + ')');

    const configs = o.config ? [path.resolve(o.config)] : desktopConfigPaths();

    if (!o.uninstall) {
      // 1. notebook folder
      let folder = o.folder || process.env.CHIPPY_NOTEBOOK || null;
      if (!folder) {
        const agent = readIfExists(path.join(ROOT, 'agent.md'));
        const guess = agent && folderFromAgentMd(agent);
        folder = await ask(rl, '  Notebook folder' + (guess ? ' [' + guess + ']' : '') + ': ', guess);
      }
      if (!folder) { console.error('\nNo notebook folder given. Use --folder <path>.'); return 1; }
      folder = path.resolve(folder.replace(/^"(.*)"$/, '$1'));
      if (!isChippyFolder(folder)) {
        console.error('\n' + folder + ' is not a Chippy data folder (no navigation.sys.chippy.md).\nOpen it once in the Chippy app, or pass the right --folder.');
        return 1;
      }
      o.folder = folder;
      console.log('  Notebook   ' + folder);
      console.log('  Mode       ' + (o.readOnly ? 'read-only' : 'read + write') + (o.includeSensitive ? ', including sensitive' : ', sensitive hidden'));

      // 2. smoke test
      if (!o.skipTest) {
        try {
          const r = await smokeTest(folder);
          console.log('  Test       ok — server answered, ' + r.discussions + ' discussion(s) visible');
        } catch (e) {
          console.error('\nThe server could not be started against this folder: ' + e.message);
          return 1;
        }
      }
    }

    // 3. confirm
    for (const f of configs) console.log('  Config     ' + f);
    if (o.claudeCode) console.log('  Also       Claude Code (user scope)');
    if (o.dryRun) console.log('\n  (dry run — nothing will be written)');
    else if (interactive) {
      const a = await ask(rl, '\n  ' + (o.uninstall ? 'Remove' : 'Install') + ' "' + o.name + '"? [Y/n] ', 'y');
      if (!/^y(es)?$/i.test(a)) { console.log('  Cancelled.'); return 2; }
    }

    // 4. Claude Desktop config(s)
    const entry = o.uninstall ? null : serverEntry(o);
    let failed = false;
    console.log('');
    for (const f of configs) {
      try {
        const r = updateConfigFile(f, cfg => (o.uninstall ? withoutServer(cfg, o.name) : withServer(cfg, o.name, entry)), { dryRun: o.dryRun });
        const verb = { added: 'added to', updated: 'updated in', unchanged: 'already up to date in', removed: 'removed from', absent: 'not present in' }[r.action];
        console.log('  ' + (o.dryRun && ['added', 'updated', 'removed'].includes(r.action) ? 'would be ' : '') + '"' + o.name + '" ' + verb + ' ' + f + (r.backup ? '\n    backup: ' + r.backup : ''));
      } catch (e) {
        failed = true;
        console.error('  ' + f + ': ' + e.message);
      }
    }
    if (entry && (o.dryRun || process.env.CHIPPY_SETUP_VERBOSE)) console.log('\n' + JSON.stringify({ mcpServers: { [o.name]: entry } }, null, 2));

    // 5. Claude Code
    if (o.claudeCode && !o.dryRun) {
      const r = registerClaudeCode(o, { uninstall: o.uninstall });
      console.log('  ' + r.message);
      if (!r.ok) failed = true;
    }

    if (!o.dryRun && !failed) {
      console.log('\nDone. Quit Claude Desktop completely (tray icon → Quit) and start it again.' +
        (o.uninstall ? '' : '\nThen ask Claude e.g. "list my Chippy discussions". Server logs: Claude\\logs\\mcp-server-' + o.name + '.log'));
    }
    return failed ? 1 : 0;
  } finally {
    if (rl) rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, err => { console.error(err); process.exitCode = 1; });
}
