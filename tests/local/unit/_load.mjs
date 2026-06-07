// SPDX-License-Identifier: Apache-2.0
//
// Side-effect loader for Chippy's classic (non-module) scripts under Node.
//
// format.js and store.js attach their API to globalThis.Chippy (the same trick
// regressionharness/adapter.mjs uses for format.js). They contain no top-level
// DOM/IO access — store.js reaches Chippy.io only lazily, inside async actions —
// so importing them for side-effect in Node is safe and needs no DOM shim.
//
// Import this once at the top of a unit test, then read the pure helpers off the
// returned namespaces.

import '../../../src/local/format.js';   // defines globalThis.Chippy.format
import '../../../src/local/taxonomy.js'; // defines globalThis.Chippy.tags (store.js needs it)
import '../../../src/local/store.js';    // defines globalThis.Chippy.store

const Chippy = globalThis.Chippy;
if (!Chippy?.format) throw new Error('format.js did not register globalThis.Chippy.format');
if (!Chippy?.store) throw new Error('store.js did not register globalThis.Chippy.store');

export const format = Chippy.format;
export const store = Chippy.store;
