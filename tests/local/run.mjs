// SPDX-License-Identifier: Apache-2.0
//
// Four-phase test orchestrator for Chippy's `local` app (src/local).
//
//   1. unit              node:test over pure logic (format.js / store.js)   — gates everything
//   2. e2e/create        Playwright: seed a full dataset from zero          — produces CHIPPY_SEED_DIR
//   3. e2e/operate       Playwright: read/operate on the seeded data        — only if data exists
//   4. data              node:test: validate on-disk files vs the spec      — whenever data exists
//
// Ordering and the conditional gates are expressed here (not in shell `&&`/`;`)
// so the pipeline behaves identically on Windows and POSIX.
//
// Each run goes in its own timestamped folder under tests/local/.tmp/runs/. The
// run's per-test results are recorded as entries in the Test Execution
// discussion inside that dataset: a run-summary entry plus one entry per test
// (name + PASS/FAIL/SKIP). Per-test results come from each runner's structured
// output — TAP for node:test, the JSON reporter for Playwright.
//
// The data phase runs whenever creation produced data, even if a later phase
// failed; CHIPPY_DATA_MODE is full/partial accordingly. The process still exits
// non-zero on any failure, so running later steps never masks an earlier one.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { appendTestResults } from './e2e/fixtures/testresult.mjs';
import { parseTap, parsePlaywright } from './report.mjs';

// run.mjs lives at tests/local/ — repo root is two levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNS = join(ROOT, 'tests', 'local', '.tmp', 'runs');
const REPORTS = process.env.CHIPPY_REPORTS_DIR ?? join(ROOT, 'tests', 'local', '.tmp', 'reports');

// Each run gets its own timestamped folder (YYYY-MM-DD_hh-mm-ss_testrun) unless
// the caller pins CHIPPY_SEED_DIR explicitly. Local time; sorts chronologically.
function runLabel(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
         `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_testrun`;
}
const STARTED = new Date();
const tsOf = d => { const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const SEED = process.env.CHIPPY_SEED_DIR ?? join(RUNS, runLabel(STARTED));
process.env.CHIPPY_SEED_DIR = SEED; // make it visible to every child phase

/* --------------------------- phase runners --------------------------- */
// Each runner streams the child's output, returns { ok, tests: [{phase,name,status}] }.

function tee(r) {
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
}

function runNodeTest(label, glob, phase) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync('node', ['--test', '--test-reporter=tap', glob],
    { shell: true, cwd: ROOT, encoding: 'utf8', env: process.env });
  tee(r);
  const ok = r.status === 0;
  console.log(ok ? `--- ${label}: PASS` : `--- ${label}: FAIL (exit ${r.status})`);
  return { ok, tests: parseTap(r.stdout || '', phase) };
}

// Playwright -> JSON reporter file (delegates to the shared parser).
function parsePlaywrightJson(file, phase) {
  if (!existsSync(file)) return [];
  try { return parsePlaywright(JSON.parse(readFileSync(file, 'utf8')), phase); } catch (_) { return []; }
}

function runPlaywright(label, testPath, phase) {
  console.log(`\n=== ${label} ===`);
  mkdirSync(REPORTS, { recursive: true });
  const jsonFile = join(REPORTS, phase + '.json');
  rmSync(jsonFile, { force: true });
  const r = spawnSync('npx',
    ['playwright', 'test', '--project=local', '--reporter=line,json', testPath],
    { shell: true, cwd: ROOT, encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile } });
  tee(r);
  const ok = r.status === 0;
  console.log(ok ? `--- ${label}: PASS` : `--- ${label}: FAIL (exit ${r.status})`);
  return { ok, tests: parsePlaywrightJson(jsonFile, phase) };
}

// A discussion .md is any root-level .md that isn't a reserved index file.
const RESERVED = new Set(['navigation.md', 'tags.md', 'names.md', 'summary.md']);
function seedHasData() {
  if (!existsSync(SEED)) return false;
  return readdirSync(SEED).some(
    f => f.endsWith('.md') && !f.endsWith('.archive.md') && !RESERVED.has(f)
  );
}

// Zero-data precondition; the create phase creates and fills SEED. Record a
// latest.txt pointer and prune old runs.
rmSync(SEED, { recursive: true, force: true });
try { mkdirSync(RUNS, { recursive: true }); writeFileSync(join(RUNS, 'latest.txt'), SEED + '\n'); } catch (_) {}
try {
  const keep = Number(process.env.CHIPPY_KEEP_RUNS ?? 10);
  const prior = readdirSync(RUNS).filter(n => n.endsWith('_testrun')).sort();
  for (const old of prior.slice(0, Math.max(0, prior.length - keep))) {
    rmSync(join(RUNS, old), { recursive: true, force: true });
  }
} catch (_) {}
console.log(`test run folder: ${SEED}`);

const results = []; // { phase, name, status }

// 1 — unit. Cheap and foundational; a failure here stops the run immediately.
const r1 = runNodeTest('Phase 1 — unit', '"tests/local/unit/**/*.test.mjs"', 'unit');
results.push(...r1.tests);
if (!r1.ok) { console.error('\nUnit tests failed — stopping before the E2E phases.'); process.exit(1); }

// 2 — content creation. Capture the result; do NOT stop on failure.
const r2 = runPlaywright('Phase 2 — e2e/create (seed)', 'tests/local/e2e/create', 'create');
const createOk = r2.ok;
results.push(...r2.tests);

// 3 — main set. Only meaningful if creation left data to operate on.
let operateOk = true;
if (seedHasData()) {
  const r3 = runPlaywright('Phase 3 — e2e/operate', 'tests/local/e2e/operate', 'operate');
  operateOk = r3.ok;
  results.push(...r3.tests);
} else {
  console.warn('\nNo seed data on disk — skipping Phase 3 (e2e/operate).');
}

// 4 — data consistency. Runs whenever creation produced any data.
let dataOk = true;
if (seedHasData()) {
  process.env.CHIPPY_DATA_MODE = createOk ? 'full' : 'partial';
  console.log(`\ndata mode: ${process.env.CHIPPY_DATA_MODE}`);
  const r4 = runNodeTest('Phase 4 — data consistency', '"tests/local/data/**/*.test.mjs"', 'data');
  dataOk = r4.ok;
  results.push(...r4.tests);
} else {
  console.warn('\nNo seed data on disk — skipping Phase 4 (data consistency).');
}

const allOk = createOk && operateOk && dataOk;

// Record this run into the Test Execution discussion: a run summary plus one
// entry per test (name + result). Sequential fictional timestamps keep the
// entries unique and chronological. No-op if creation never produced the skeleton.
try {
  const baseMs = STARTED.getTime();
  let i = 0;
  const nextTs = () => tsOf(new Date(baseMs + (i++) * 1000));
  const RESULT = { passed: 'PASS', failed: 'FAIL', skipped: 'SKIP' };
  // Test names are log text, not content: neutralize markup the app/validator
  // would otherwise interpret (a @[Name] ref, an ![image] trigger).
  const safe = s => String(s).replace(/@\[([^\]]+)\]/g, '@$1').replace(/!\[/g, '[');

  const phaseLine = (ph, label) => {
    const all = results.filter(r => r.phase === ph);
    const c = st => all.filter(r => r.status === st).length;
    if (!all.length) return `${label}: no tests captured`;
    return `${label}: ${c('passed')}/${all.length} passed` +
           (c('failed') ? `, ${c('failed')} failed` : '') +
           (c('skipped') ? `, ${c('skipped')} skipped` : '');
  };

  const entries = [];
  entries.push({
    created_at: nextTs(),
    tags: ['testrun', allOk ? 'passed' : 'failed'],
    body: [
      `Automated test run — pipeline ${allOk ? 'PASS' : 'FAIL'}.`,
      '',
      phaseLine('unit', 'Phase 1 (unit)'),
      phaseLine('create', 'Phase 2 (create)'),
      phaseLine('operate', 'Phase 3 (operate)'),
      phaseLine('data', 'Phase 4 (data)'),
      '',
      `Run folder: ${basename(SEED)}`
    ].join('\n')
  });
  for (const r of results) {
    entries.push({
      created_at: nextTs(),
      tags: ['testresult', r.status],
      body: `[${r.phase}] ${safe(r.name)} — ${RESULT[r.status] || r.status}`
    });
  }
  const n = appendTestResults(SEED, entries);
  if (n) console.log(`recorded ${n} entries (1 summary + ${results.length} tests) in the Test Execution discussion`);
} catch (e) { console.warn('could not record test results:', e.message); }

console.log(`\n=== pipeline ${allOk ? 'PASS' : 'FAIL'} ===`);
process.exit(allOk ? 0 : 1);
