// (clean-room contract harness — no copied implementation)
//
// Regression harness — parse→serialize round-trip identity over realistic reference data.
// Pure Node, no dependencies. Run:  node roundtrip.test.mjs
//
// This harness contains NO parser/serializer of its own. It tests whatever adapter.mjs is wired
// to — the intent being chippy's own from-scratch format layer. Until the adapter is wired
// (IMPLEMENTED = true), the runner reports PENDING and exits non-zero.
//
// What it asserts once wired: for every file in ./referencedata/, serialize(parse(file)) equals
// the file byte-for-byte. The reference files are authored in canonical form, so any drift means
// the format layer changed its output — the early warning the harness exists to give.
// Routing by filename: navigation.md → nav fns, tags.md → tags fns, names.md → names fns,
// every other .md → discussion fns.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  IMPLEMENTED,
  parseDiscussion, serializeDiscussion,
  parseNav, serializeNav,
  parseTags, serializeTags,
  parseNames, serializeNames
} from './adapter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'referencedata');

if (!IMPLEMENTED) {
  console.log('PENDING — the regression harness is not yet wired to an implementation.');
  console.log('Implement chippy/format.js from scratch, wire adapter.mjs to it, and set IMPLEMENTED = true.');
  console.log('The files in ./referencedata and ../documentation/datadefinition.md define the contract.');
  process.exit(2);
}

let passed = 0, failed = 0;
const failures = [];

function ok(name) { passed++; console.log(`  PASS  ${name}`); }
function bad(name, detail) { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}`); }

// First character index where two strings differ, with a small context window.
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const show = s => JSON.stringify(s.slice(Math.max(0, i - 30), i + 30));
  return `len got=${a.length} exp=${b.length}; first diff at index ${i}\n` +
         `      got …${show(a)}…\n` +
         `      exp …${show(b)}…`;
}

function assertEqual(name, got, exp) {
  if (got === exp) ok(name);
  else bad(name, firstDiff(got, exp));
}

// Pick the right round-trip for a given index/discussion file. The optional
// (\.chippy) group keeps legacy-named reference fixtures round-trippable.
function roundtrip(file, content) {
  if (/^navigation(\.chippy)?\.md$/i.test(file)) return serializeNav(parseNav(content));
  if (/^tags(\.chippy)?\.md$/i.test(file))       return serializeTags(parseTags(content));
  if (/^names(\.chippy)?\.md$/i.test(file))      return serializeNames(parseNames(content));
  return serializeDiscussion(parseDiscussion(content, file));
}

console.log('\nReference-data round-trip identity:');
for (const file of readdirSync(DATA).filter(f => f.endsWith('.md')).sort()) {
  const content = readFileSync(join(DATA, file), 'utf8');
  assertEqual(file, roundtrip(file, content), content);
}

console.log(`\n${'='.repeat(48)}`);
console.log(`Total: ${passed + failed}   Passed: ${passed}   Failed: ${failed}`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`\n• ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
console.log('All round-trip checks passed.');
