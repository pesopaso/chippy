// SPDX-License-Identifier: Apache-2.0
//
// taxonomy.js — single source of truth for the tag vocabulary (classic script
// → window.Chippy.tags).
//
// The reserved-tag regex, the task/followup/goal state machine, and the
// priority vocabulary all live here so the view modules (ui, discussion, pages,
// dashboard) and the store classify tags identically and can never drift apart.
// Pure: no DOM, no I/O, so it also loads cleanly in the Node regression harness.
// Must load AFTER format.js and BEFORE store/ui/discussion/pages/dashboard.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});

  /* ----------------------------- reserved tags ------------------------- */
  // Tags that the app manages internally (state, priority, goal/followup
  // markers, mutes, goal ids). These are never shown as free-form chips.
  const RESERVED = /^(task|followup|goal|opentask|inprogresstask|checktask|onholdtask|purgatorytask|resolvedtask|obsoletetask|resolvedfollowup|achievedgoal|canceledgoal|resolvedgoal|high|medium|low|goal-[a-z0-9]{5}|muted:.*)$/;
  const isReserved = (tag) => RESERVED.test(tag);

  // The reserved tags a user may legitimately type by hand (in the new-comment
  // box or the inline editor) to classify or prioritize an entry: the three
  // kind tags and the three priorities. State tags, goal ids, and mutes stay
  // app-managed and are never accepted as typed input.
  const PROMOTABLE = /^(task|followup|goal|high|medium|low)$/;

  /* ------------------------------ task state --------------------------- */
  // Ordered: first state whose tags match wins; the fallback is 'open'.
  // `square` is [label, css-class] for the clickable state square.
  const STATES = [
    { key: 'inprogress', tags: ['inprogresstask', 'inprogress'],         square: ['WIP',  'state-inprogresstask'] },
    { key: 'check',      tags: ['checktask'],                            square: ['CHK',  'state-checktask'] },
    { key: 'onhold',     tags: ['onholdtask', 'onhold'],                 square: ['HOLD', 'state-onholdtask'] },
    { key: 'purgatory',  tags: ['purgatorytask', 'purgatory'],          square: ['PRGT', 'state-purgatorytask'] },
    { key: 'resolved',   tags: ['resolvedtask', 'resolvedfollowup'],    square: ['DONE', 'state-resolvedtask'] },
    { key: 'obsolete',   tags: ['obsoletetask'],                        square: ['OBSL', 'state-obsoletetask'] }
  ];

  function stateKeyOf(tags) {
    for (const s of STATES) {
      for (const t of s.tags) if (tags.includes(t)) return s.key;
    }
    return 'open';
  }

  // key -> [label, css-class]; identical shape to the former per-module maps so
  // call sites can keep destructuring `const [label, cls] = STATE_SQUARE[key]`.
  const STATE_SQUARE = { open: ['OPEN', 'state-open'] };
  for (const s of STATES) STATE_SQUARE[s.key] = s.square;

  /* ------------------------------ entry type --------------------------- */
  function entryType(e) {
    const t = e.tags || [];
    if (t.includes('goal')) return 'goal';
    if (t.includes('followup')) return 'followup';
    if (t.includes('task')) return 'task';
    return 'comment';
  }

  /* ------------------------------ priority ----------------------------- */
  const PRIO_RANK = { high: 0, medium: 1, low: 2 };
  const PRIO_LABEL = { high: 'HI', medium: 'MI', low: 'LO' };
  // The priority tag present, or null when none is set. Callers that need a
  // default apply `|| 'low'` themselves (as they did before centralization).
  const priorityOf = (tags) => tags.find((t) => t === 'high' || t === 'medium' || t === 'low') || null;

  Chippy.tags = {
    RESERVED, isReserved, PROMOTABLE,
    STATES, stateKeyOf, STATE_SQUARE,
    entryType,
    PRIO_RANK, PRIO_LABEL, priorityOf
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
