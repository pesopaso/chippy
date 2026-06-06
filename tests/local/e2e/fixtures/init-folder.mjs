// SPDX-License-Identifier: Apache-2.0
//
// Initiation batch — creates the *initial folder* the app needs to open.
//
// The app (today a scaffold) can add entries to an existing discussion but
// cannot create discussions or open an empty folder (loadIndexes requires a
// navigation.md). So this Node batch lays down the minimal skeleton — an index
// trio plus one empty discussion file per discussion — and the app then fills
// in every comment through its real write-path.
//
// It reuses the app's own format.js serializer (loaded for side-effect, the
// globalThis.Chippy trick) so the skeleton is byte-canonical from the start.
//
// Standalone:  node tests/local/e2e/fixtures/init-folder.mjs [targetDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../../../src/local/format.js'; // defines globalThis.Chippy.format
import { TESTRESULT_NAME } from './testresult.mjs';

const fmt = globalThis.Chippy.format;

export function createSkeleton(dir, discussionNames) {
  mkdirSync(dir, { recursive: true });

  // The content discussions plus the Test Execution meta-discussion (run results).
  const allNames = [...discussionNames, TESTRESULT_NAME];

  const nav = {
    theme: 'dark',
    discussions: allNames.map(name => ({ name, tag: null, favorite: false, archived: false }))
  };
  writeFileSync(join(dir, 'navigation.md'), fmt.serializeNav(nav));
  writeFileSync(join(dir, 'tags.md'), fmt.serializeTags([]));
  writeFileSync(join(dir, 'names.md'), fmt.serializeNames([]));

  // Same sanitisation rule the app uses: keep [A-Za-z0-9_ -].
  const sanitize = n => String(n).replace(/[^A-Za-z0-9_ -]/g, '');
  for (const name of allNames) {
    const member = { name, group: null, archived: false, prep: '', entries: [] };
    writeFileSync(join(dir, sanitize(name) + '.md'), fmt.serializeDiscussion(member));
  }
  return { dir, discussions: discussionNames.length };
}

// Standalone entry point.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.tmp', 'seed');
  // Lazy import to avoid a hard dependency when used as a module.
  const { DISCUSSION_NAMES } = await import('./dataset.mjs');
  const r = createSkeleton(target, DISCUSSION_NAMES);
  console.log(`skeleton: ${r.discussions} discussions -> ${r.dir}`);
}
