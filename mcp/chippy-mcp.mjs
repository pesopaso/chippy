#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// chippy-mcp.mjs — MCP server for a Chippy notebook folder (stdio transport).
//
//   node mcp/chippy-mcp.mjs --folder "C:\path\to\Notebook" [--read-only] [--include-sensitive]
//
// The folder can also come from the CHIPPY_NOTEBOOK environment variable.
// Messages are newline-delimited JSON-RPC 2.0 on stdin/stdout; stdout carries
// protocol messages only, all logging goes to stderr. No dependencies — the
// protocol subset a tools-only server needs is small (see chippy-tools.mjs).
// Setup and tool reference: mcp/README.md.

import readline from 'node:readline';

// stdout belongs to the protocol: route any stray console output to stderr
// BEFORE the app scripts load.
console.log = console.info = console.debug = (...a) => console.error(...a);

const { createChippyServer, chippyVersion } = await import('./chippy-tools.mjs');

function parseArgs(argv) {
  const o = { folder: process.env.CHIPPY_NOTEBOOK || '', readOnly: false, includeSensitive: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--folder') o.folder = argv[++i] || '';
    else if (a.startsWith('--folder=')) o.folder = a.slice(9);
    else if (a === '--read-only') o.readOnly = true;
    else if (a === '--include-sensitive') o.includeSensitive = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version') o.version = true;
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.version) { process.stderr.write(chippyVersion() + '\n'); process.exit(0); }
if (opts.help || !opts.folder) {
  process.stderr.write('Usage: node mcp/chippy-mcp.mjs --folder <notebook folder> [--read-only] [--include-sensitive]\n' +
                       '       (or set CHIPPY_NOTEBOOK)\n');
  process.exit(opts.help ? 0 : 2);
}

const server = createChippyServer(opts);
console.error('[chippy-mcp] v' + chippyVersion() + ' serving ' + server.folder +
              (server.readOnly ? ' (read-only)' : '') + (server.includeSensitive ? ' (including sensitive)' : ''));

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); }
  catch (_) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  const batch = Array.isArray(msg) ? msg : [msg];
  for (const m of batch) {
    const p = server.handle(m)
      .then((res) => { if (res) send(res); })
      .catch((err) => {
        console.error('[chippy-mcp] internal error:', err);
        if (m && m.id !== undefined && m.id !== null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'Internal error' } });
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  }
});

// Let in-flight writes finish before exiting when the client closes stdin.
rl.on('close', async () => { await Promise.allSettled([...pending]); process.exit(0); });
