// SPDX-License-Identifier: Apache-2.0
//
// Phase 3 — end-to-end task & goal lifecycle workflows over the seeded data.

import { test, expect } from '../fixtures/operate.mjs';

test.describe('task & goal lifecycle workflows', () => {
  test('achieve a goal; the linked comment keeps its goal-<id>', async ({ app }) => {
    const before = await app.readDiscussion('1-1 Maria Lopez');
    const gid = (before.match(/goal-[0-9a-z]{5}/) || [])[0];
    expect(gid).toBeTruthy();

    await app.open('1-1 Maria Lopez');
    await app.achieveGoal(app.goalRow('Senior promotion'));

    await expect.poll(() => app.readDiscussion('1-1 Maria Lopez')).toContain('achievedgoal');
    const after = await app.readDiscussion('1-1 Maria Lopez');
    expect(after).toContain('Achieved:');
    // goal-<id> appears on both the goal entry and the linked comment.
    expect((after.match(new RegExp(gid, 'g')) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('resolve an open followup (resolvedfollowup + Resolved: marker)', async ({ app }) => {
    await app.open('1-1 James Okafor');
    await app.chooseState(app.taskRow('Follow up on the training budget'), 'DONE');
    await expect.poll(() => app.readDiscussion('1-1 James Okafor')).toContain('resolvedfollowup');
    expect(await app.readDiscussion('1-1 James Okafor')).toContain('Resolved:');
  });
});
