// SPDX-License-Identifier: Apache-2.0
//
// ui.js — reusable, data-agnostic controls. Stub (classic script → window.Chippy.ui).
// Future: the single safeSetHtml/DOMPurify boundary, renderEntryText, tag-chip
// input, #/@ autocomplete, state dropdown, priority dot, due-date picker, action
// modal, toast, image overlay/gallery. Implemented from Step 5 onward.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});
  Chippy.ui = {};
})(typeof globalThis !== 'undefined' ? globalThis : this);
