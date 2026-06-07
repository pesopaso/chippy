// SPDX-License-Identifier: Apache-2.0
//
// The full-spectrum seed dataset + the in-app driver that creates it.
//
// DATASET is plain serializable data (so it can cross into page.evaluate). Each
// discussion lists entries to add through the app's REAL store actions; per
// entry, optional post-add operations drive state transitions, goal links and
// action logs — exercising format.js serialization and io.js persistence.
//
// runDriver(dataset, store) is self-contained (no imports/closures) so Playwright
// can serialize it into the page; in the browser `store` defaults to
// window.Chippy.store, and the Node verifier passes the loaded store directly.
//
// Determinism: timestamps and goal-ids come from window.__chippyTest.now/.rng,
// so the output is byte-reproducible. (mute is intentionally omitted — its
// expiry uses the real clock and is not injectable.)

export const DISCUSSION_NAMES = [
  '1-1 Maria Lopez',
  '1-1 James Okafor',
  'Cloud Migration',
  'SOC 2 Compliance'
];

export const DATASET = [
  {
    name: '1-1 Maria Lopez',
    entries: [
      { text: 'Kickoff: aligned on Q2 objectives.' },
      { text: 'Monthly check-in completed.', tags: ['checkin'] },                                                  // checkin tag (People only)
      { text: 'Fix the deployment pipeline by end of sprint.', tags: ['task', 'high'], due: '2026-03-05' },        // OPEN
      { text: 'Completed code review for PR #42.', tags: ['task', 'low'],                                          // DONE
        actions: ['Reviewed and merged the change'], taskState: 'resolved' },
      { text: 'Senior promotion — finalize scope and stakeholders.', tags: ['goal', 'high'], due: '2026-06-30',
        goalKey: 'promo' },                                                                                        // goal (open)
      { text: 'Strong collaboration noted in sprint review.', tags: ['technical'], linkGoal: 'promo' }            // goal-linked comment
    ]
  },
  {
    name: '1-1 James Okafor',
    entries: [
      { text: 'Follow up on the training budget.', tags: ['followup'] },                                           // open followup (no @name)
      { text: 'Confirmed the training budget was approved.', tags: ['followup'], taskState: 'resolved' },         // resolvedfollowup
      { text: 'Investigate flaky CI on staging.', tags: ['task', 'medium'], taskState: 'inprogress' },            // WIP
      { text: 'Migrate legacy auth — blocked on the vendor.', tags: ['task', 'low'], taskState: 'onhold' }        // HOLD
    ]
  },
  {
    name: 'Cloud Migration',
    entries: [
      { text: 'Architecture charter at charter https://wiki.example.com/cloud-charter', tags: ['kickoff'] },       // kickoff tag + URL
      { text: 'Follow up on the training budget with @[Priya Nair].', tags: ['followup'] },                       // @Priya Nair — DEV only
      { text: 'Owner @[Marcus Chen] to validate the staging cutover.' },                                           // @name
      { text: 'Define the rollback runbook.', tags: ['task', 'high'], taskState: 'check' },                        // CHK
      { text: 'Drop the on-prem load balancer.', tags: ['task', 'low'], taskState: 'obsolete' },                   // OBSL
      { text: 'Define success metrics for the migration.', tags: ['goal', 'medium'], goalKey: 'metrics' },         // open goal
      { text: 'Complete migration of tier-1 services.', tags: ['goal', 'high'], due: '2026-09-30',
        goalKey: 'mig', goalState: 'achieved' }                                                                    // achieved goal
    ]
  },
  {
    name: 'SOC 2 Compliance',
    entries: [
      { text: 'Auditor @[Dana Whitfield] kickoff; policy https://wiki.example.com/soc2-policy' },                  // @name + URL
      { text: 'Adopt continuous control monitoring.', tags: ['goal', 'medium'], due: '2026-12-31',
        goalKey: 'ccm', goalState: 'canceled' },                                                                   // canceled goal
      { text: 'Evidence collection automation.', tags: ['task', 'medium'], taskState: 'purgatory' }                // PRGT
    ]
  }
];

// Self-contained (no module-scope references) so Playwright can serialize it
// into page.evaluate. The Node verifier calls it directly with a store arg.
export async function runDriver(dataset, store) {
  store = store || (typeof window !== 'undefined' && window.Chippy && window.Chippy.store);
  if (!store) throw new Error('runDriver: no store available');
  const GOAL_ID_RE = /^goal-[0-9a-z]{5}$/;

  const goalIds = {};
  const summary = { discussions: 0, entries: 0 };

  for (const d of dataset) {
    await store.selectMember(d.name);
    summary.discussions++;

    for (const en of d.entries) {
      const opts = {
        text: en.text,
        tags: (en.tags || []).slice(),
        due: en.due || null,
        goalLinkId: en.linkGoal ? goalIds[en.linkGoal] : null
      };
      const e = await store.addEntry(d.name, opts);
      if (!e) continue;
      summary.entries++;

      if (en.goalKey) {
        const gid = (e.tags || []).find(t => GOAL_ID_RE.test(t));
        if (gid) goalIds[en.goalKey] = gid;
      }
      if (en.actions) for (const a of en.actions) await store.appendAction(d.name, e.created_at, a);
      if (en.taskState) await store.setTaskState(d.name, e.created_at, en.taskState);
      if (en.goalState) await store.setGoalState(d.name, e.created_at, en.goalState);
    }
  }
  return summary;
}
