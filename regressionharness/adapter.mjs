// Adapter between the regression harness and chippy's own (from-scratch) format layer.
//
// chippy's format layer is a CLASSIC script (no import/export) so the app can run
// from file://. It attaches its API to the global Chippy namespace. Here we load it
// for side-effect (valid in Node — the file is plain statements) and read the
// functions off globalThis.Chippy.format.
//
// The harness contract is the reference data in ./referencedata/ and the spec in
// ../documentation/datadefinition.md.

import '../src/local/format.js'; // side-effect: defines globalThis.Chippy.format

const f = globalThis.Chippy.format;

export const parseDiscussion = f.parseDiscussion;
export const serializeDiscussion = f.serializeDiscussion;
export const parseNav = f.parseNav;
export const serializeNav = f.serializeNav;
export const parseTags = f.parseTags;
export const serializeTags = f.serializeTags;
export const parseNames = f.parseNames;
export const serializeNames = f.serializeNames;

export const IMPLEMENTED = true;
