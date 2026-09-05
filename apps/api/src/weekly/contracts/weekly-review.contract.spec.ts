import type { CoachContext } from '../../coach/context/context.types';
import type { WeeklyReviewOutput } from '../weekly.schema';
import {
  allowedIdsFrom,
  guardReviewOutput,
  WEEKLY_REVIEW_SCHEMA_NAME,
} from './weekly-review.contract';

// =============================================================================
// The hallucination guard (issue #73)
// =============================================================================
//
// A reviewer that proposes moving a routine the user does not have writes a
// confident, specific, entirely plausible sentence, and the diff the user is
// shown would be a diff of nothing. Worse, `createFromSource` answers 422 for a
// foreign plan id, so without this guard the failure lands mid-generation.
// =============================================================================

const PLAN_ID = '2a7c9f10-4b3d-4d1e-8c9a-7f6e5d4c3b21';
const ROUTINE_ID = '9c3a1e77-1b6d-4a3e-9f1a-0b2c3d4e5f60';
const COMMITMENT_ID = '5b2e8d31-7a4c-4c2b-8e5d-1a2b3c4d5e6f';
const FOREIGN = '00000000-0000-4000-8000-000000000999';

const ALLOWED = {
  planIds: new Set([PLAN_ID]),
  routineIds: new Set([ROUTINE_ID]),
  commitmentIds: new Set([COMMITMENT_ID]),
};

function output(
  proposedChanges: WeeklyReviewOutput['proposedChanges'],
): WeeklyReviewOutput {
  return {
    whatWorked: ['Work: 4 of 5 done.'],
    whatDidNot: [],
    patterns: [],
    proposedChanges,
    keepUnchanged: [],
    doNotAddYet: [],
  };
}

const moveRoutine = (id: string | null) => ({
  op: 'move' as const,
  target: { type: 'routine' as const, id },
  before: { preferredTime: '18:30' },
  after: { preferredTime: '09:00' },
  reason: 'Evenings were moved twice; mornings held.',
});

describe('guardReviewOutput', () => {
  it('keeps a proposal whose plan and targets the user actually has', () => {
    const result = guardReviewOutput(
      output([{ planId: PLAN_ID, summary: 'Move it', changes: [moveRoutine(ROUTINE_ID)] }]),
      ALLOWED,
    );

    expect(result.output.proposedChanges).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it('drops a proposal naming a plan the user does not have', () => {
    const result = guardReviewOutput(
      output([{ planId: FOREIGN, summary: 'Move it', changes: [moveRoutine(ROUTINE_ID)] }]),
      ALLOWED,
    );

    expect(result.output.proposedChanges).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it('drops a proposal whose change targets a routine the user does not have', () => {
    const result = guardReviewOutput(
      output([{ planId: PLAN_ID, summary: 'Move it', changes: [moveRoutine(FOREIGN)] }]),
      ALLOWED,
    );

    expect(result.output.proposedChanges).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it('keeps an `add`, which has nothing to point at yet', () => {
    const result = guardReviewOutput(
      output([
        {
          planId: PLAN_ID,
          summary: 'Add a short walk',
          changes: [
            {
              op: 'add' as const,
              target: { type: 'routine' as const, id: null },
              before: null,
              after: { title: 'Ten-minute walk', estimatedDurationMin: 10 },
              reason: 'Something small on the days the workout does not fit.',
            },
          ],
        },
      ]),
      ALLOWED,
    );

    expect(result.output.proposedChanges).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it('checks commitment targets against the commitment ids, not the routine ids', () => {
    const targeting = (id: string) => ({
      planId: PLAN_ID,
      summary: 'Pause it',
      changes: [
        {
          op: 'pause' as const,
          target: { type: 'commitment' as const, id },
          before: null,
          after: null,
          reason: 'Travel week.',
        },
      ],
    });

    expect(guardReviewOutput(output([targeting(COMMITMENT_ID)]), ALLOWED).dropped).toBe(0);
    // A routine id in a commitment target is still a foreign id.
    expect(guardReviewOutput(output([targeting(ROUTINE_ID)]), ALLOWED).dropped).toBe(1);
  });

  it('drops only the offending proposal and reports the count', () => {
    const result = guardReviewOutput(
      output([
        { planId: PLAN_ID, summary: 'Keep me', changes: [moveRoutine(ROUTINE_ID)] },
        { planId: FOREIGN, summary: 'Drop me', changes: [moveRoutine(ROUTINE_ID)] },
      ]),
      ALLOWED,
    );

    expect(result.output.proposedChanges.map((p) => p.summary)).toEqual(['Keep me']);
    expect(result.dropped).toBe(1);
  });

  it('leaves the other five outputs untouched', () => {
    const given = output([{ planId: FOREIGN, summary: 'x', changes: [moveRoutine(null)] }]);
    const result = guardReviewOutput(given, ALLOWED);

    expect(result.output.whatWorked).toEqual(given.whatWorked);
  });
});

describe('allowedIdsFrom', () => {
  it('collects plan, routine and commitment ids out of a context', () => {
    const context = {
      activePlans: [
        {
          planId: PLAN_ID,
          routines: [{ routineId: ROUTINE_ID }],
        },
      ],
      todayCommitments: [{ commitmentId: COMMITMENT_ID }],
      recentMisses: [],
    } as unknown as CoachContext;

    const allowed = allowedIdsFrom(context);

    expect([...allowed.planIds]).toEqual([PLAN_ID]);
    expect([...allowed.routineIds]).toEqual([ROUTINE_ID]);
    expect([...allowed.commitmentIds]).toEqual([COMMITMENT_ID]);
  });
});

describe('the schema name', () => {
  // The fake OpenAI server selects its scenario on this exact string (E06-09).
  it('is the string the gateway puts on the wire', () => {
    expect(WEEKLY_REVIEW_SCHEMA_NAME).toBe('weekly_review');
  });
});
