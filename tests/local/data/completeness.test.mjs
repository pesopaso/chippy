// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 — completeness / golden comparison. Only meaningful when the create
// phase fully completed (CHIPPY_DATA_MODE === 'full'); on a partial run these
// assertions would fail because the dataset is legitimately incomplete, so they
// are skipped.
//
// The golden snapshot lives in tests/data/golden/. It is empty until you capture
// the deterministic create-phase output once (and commit it). With the seeded
// RNG/date, that output is byte-reproducible, so exact comparison is valid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';
import { readSeed, validateCompleteness } from './validator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'golden');
const SEED = process.env.CHIPPY_SEED_DIR ?? join(process.cwd(), 'tests', 'local', '.tmp', 'seed');
const FULL = process.env.CHIPPY_DATA_MODE === 'full';

const goldenPopulated = existsSync(GOLDEN) && readdirSync(GOLDEN).some(f => f.endsWith('.md'));

test('seed dataset matches the golden snapshot byte-for-byte', { skip: !FULL || !goldenPopulated }, () => {
  const seed = readSeed(SEED);
  const findings = validateCompleteness(seed, GOLDEN);
  const errors = findings.filter(f => f.level === 'error');
  if (errors.length) {
    const report = errors.map(e => `  [${e.code}] ${e.file}: ${e.message}`).join('\n');
    assert.fail(`${errors.length} completeness violation(s):\n${report}`);
  }
});
