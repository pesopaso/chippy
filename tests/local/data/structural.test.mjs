// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 — structural consistency. Runs whenever the seed folder has data
// (full OR partial mode): these invariants must hold even on an interrupted run,
// which is exactly how we verify the app leaves the folder consistent mid-write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readSeed, validateStructural } from './validator.mjs';

const SEED = process.env.CHIPPY_SEED_DIR ?? join(process.cwd(), 'tests', 'local', '.tmp', 'seed');

test('seed dataset is structurally consistent with the data definition', () => {
  const seed = readSeed(SEED);
  assert.ok(seed.discussions.length > 0, `no discussion files found in ${SEED}`);

  const findings = validateStructural(seed);
  const errors = findings.filter(f => f.level === 'error');
  if (errors.length) {
    const report = errors.map(e => `  [${e.code}] ${e.file}: ${e.message}`).join('\n');
    assert.fail(`${errors.length} structural violation(s):\n${report}`);
  }
});
