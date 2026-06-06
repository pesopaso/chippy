// SPDX-License-Identifier: Apache-2.0
//
// Deterministic seed values for the content-creation phase.
//
// Chippy was built for reproducible tests: nowISO(d) takes an injectable date and
// mintGoalId(rng) / shortId(rng) take an injectable RNG. Driving those from fixed
// values here makes the generated dataset byte-reproducible run-to-run, which is
// what lets Phase 4 do exact golden-file comparison rather than structure-only
// checks.
//
// NOTE: how these values reach the app is the open wiring task for the create
// spec — e.g. a test-only hook on window, or query-param seeding the app reads
// at startup. Keep that surface tiny and test-only; never ship it in app code.

// A small deterministic PRNG (mulberry32) so goal-ids etc. are stable.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fixed clock the seed run advances deterministically (one entry per minute).
export const SEED_EPOCH = new Date(2026, 0, 5, 9, 0, 0); // 2026-01-05 09:00:00 local

export const RNG_SEED = 0xC419CD; // arbitrary fixed seed -> stable goal-ids
