// Adapter between the regression harness and chippy's own (from-scratch) format layer.
//
// The harness contains NO implementation of its own — it is a contract defined by the
// reference data in ./referencedata/ and the spec in ../documentation/datadefinition.md.
// chippy's format layer lives at ../src/local/format.js (the app's flat module root).
//
// Required function shapes:
//   parseDiscussion(md, filename) -> member { name, group, archived, prep, entries[] }
//   serializeDiscussion(member)   -> canonical md string
//   parseNav(md)                  -> nav { discussions[ {name, tag, favorite, archived} ], theme }
//   serializeNav(nav)             -> canonical md string  (split form: discussions + theme only)
//   parseTags(md)                 -> string[]   (the tag union from tags.md)
//   serializeTags(tags[])         -> canonical md string  (# Tags + list)
//   parseNames(md)                -> string[]   (known names from names.md)
//   serializeNames(names[])       -> canonical md string  (# Names + list)

import {
  parseDiscussion, serializeDiscussion,
  parseNav, serializeNav,
  parseTags, serializeTags,
  parseNames, serializeNames
} from '../src/local/format.js';

export {
  parseDiscussion, serializeDiscussion,
  parseNav, serializeNav,
  parseTags, serializeTags,
  parseNames, serializeNames
};

export const IMPLEMENTED = true;
