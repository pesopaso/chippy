// Adapter between the regression harness and chippy's own (from-scratch) IO module.
//
// The harness intentionally contains NO copied implementation — it is a contract, defined by
// the reference data in ./referencedata/ and the format spec in ../documentation/datadefinition.md.
//
// To run the suite: implement chippy/format.js from scratch, then wire the functions below to it
// and set IMPLEMENTED = true. Until then the runner reports PENDING.
//
// Required function shapes:
//   parseDiscussion(md, filename) -> member { name, group, archived, prep, entries[] }
//   serializeDiscussion(member)   -> canonical md string
//   parseNav(md)                  -> nav { discussions[ {name, tag, favorite, archived} ], theme }
//   serializeNav(nav)             -> canonical md string  (split form: discussions + theme only)
//   parseTags(md)                 -> string[]   (the tag union from tags.md)
//   serializeTags(tags[])         -> canonical md string  (# Tags + sorted, de-duped list)
//   parseNames(md)                -> string[]   (known names from names.md)
//   serializeNames(names[])       -> canonical md string  (# Names + sorted, de-duped list)

export const IMPLEMENTED = false;

// Example wiring once chippy/format.js exists (adjust names to the real module):
//   import {
//     parseDiscussion, serializeDiscussion, parseNav, serializeNav,
//     parseTags, serializeTags, parseNames, serializeNames
//   } from '../format.js';
//   export { parseDiscussion, serializeDiscussion, parseNav, serializeNav,
//            parseTags, serializeTags, parseNames, serializeNames };
//   export const IMPLEMENTED = true;   // <-- flip this

const pending = name => () => {
  throw new Error(`adapter.${name} is not wired — implement chippy/format.js and set IMPLEMENTED = true`);
};

export const parseDiscussion = pending('parseDiscussion');
export const serializeDiscussion = pending('serializeDiscussion');
export const parseNav = pending('parseNav');
export const serializeNav = pending('serializeNav');
export const parseTags = pending('parseTags');
export const serializeTags = pending('serializeTags');
export const parseNames = pending('parseNames');
export const serializeNames = pending('serializeNames');
