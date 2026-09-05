import { guardCoachOutput, type CoachOutputFacts } from './coach-output-guard';
import type { CoachReply } from './contracts/coach-reply.contract';

// =============================================================================
// The hallucination guard (issue #70)
// =============================================================================
//
// PRD §90 names three failures: a fabricated completion, an incorrect active
// plan, an invented schedule conflict. Every case below is one of them wearing
// a valid schema — which is the whole difficulty. The contract cannot catch
// these, because a made-up uuid is a perfectly well-formed uuid.
// =============================================================================

const COMMITMENT = '11111111-1111-4111-8111-111111111111';
const PLAN = '22222222-2222-4222-8222-222222222222';
const ROUTINE = '33333333-3333-4333-8333-333333333333';
const OTHER_PLAN = '44444444-4444-4444-8444-444444444444';
const OTHER_ROUTINE = '55555555-5555-4555-8555-555555555555';

const facts: CoachOutputFacts = {
  commitmentIds: new Set([COMMITMENT]),
  routineIdsByPlan: new Map([
    [PLAN, new Set([ROUTINE])],
    [OTHER_PLAN, new Set([OTHER_ROUTINE])],
  ]),
};

const reply = (over: Partial<CoachReply> = {}): CoachReply =>
  ({
    intervention_type: 'NORMAL_REMINDER',
    reasoning_summary: 'because',
    user_message: 'Do the thing.',
    recommended_action: null,
    fallback_action: null,
    proposal: null,
    friction_question: null,
    ...over,
  }) as CoachReply;

const proposal = (over: Record<string, unknown> = {}) =>
  ({
    kind: 'plan_change' as const,
    planId: PLAN,
    summary: 'Move it.',
    changes: [
      {
        op: 'move',
        target: { type: 'routine', id: ROUTINE },
        before: null,
        after: { preferredTime: '09:00' },
        reason: 'Wednesday stopped working',
      },
    ],
    ...over,
  }) as NonNullable<CoachReply['proposal']>;

describe('guardCoachOutput (#70)', () => {
  it('passes a reply that only names real things', () => {
    expect(
      guardCoachOutput(
        reply({
          recommended_action: {
            title: 'Ten minutes',
            duration_minutes: 10,
            commitmentId: COMMITMENT,
          },
          proposal: proposal(),
        }),
        facts,
      ),
    ).toEqual({ ok: true });
  });

  it('passes a reply that names no ids at all', () => {
    expect(guardCoachOutput(reply(), facts)).toEqual({ ok: true });
  });

  it('rejects an invented commitment id', () => {
    // PRD §90's "fabricated completion": the sentence would name something the
    // user was never scheduled to do.
    const result = guardCoachOutput(
      reply({
        recommended_action: {
          title: 'Ten minutes',
          duration_minutes: 10,
          commitmentId: '99999999-9999-4999-8999-999999999999',
        },
      }),
      facts,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('is not a commitment of this user');
  });

  it('rejects an invented plan id', () => {
    const result = guardCoachOutput(
      reply({ proposal: proposal({ planId: '99999999-9999-4999-8999-999999999999' }) }),
      facts,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('is not an active plan of this user');
  });

  it("rejects a routine id from another of the user's plans", () => {
    // The subtle one: ownership passes, and the change would land on a plan
    // the user was never shown a diff for.
    const result = guardCoachOutput(
      reply({
        proposal: proposal({
          changes: [
            {
              op: 'move',
              target: { type: 'routine', id: OTHER_ROUTINE },
              before: null,
              after: { preferredTime: '09:00' },
              reason: 'x',
            },
          ],
        }),
      }),
      facts,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('does not belong to plan');
  });

  it('allows an add, which has no target to check', () => {
    expect(
      guardCoachOutput(
        reply({
          proposal: proposal({
            changes: [
              {
                op: 'add',
                target: { type: 'routine', id: null },
                before: null,
                after: { title: 'Saturday walk' },
                reason: 'x',
              },
            ],
          }),
        }),
        facts,
      ),
    ).toEqual({ ok: true });
  });

  it('rejects a reply carrying both a proposal and a friction question', () => {
    // Two different questions, and the UI has one place to answer. Rejecting
    // beats picking one for the user.
    const result = guardCoachOutput(
      reply({
        proposal: proposal(),
        friction_question: { prompt: 'What got in the way?', options: ['Time', 'Energy'] },
      }),
      facts,
    );

    expect(result.ok).toBe(false);
  });

  it('reads no message text', () => {
    // A guard that judged prose would be a second unreliable classifier in
    // front of the first. Nonsense copy with real ids passes.
    expect(
      guardCoachOutput(
        reply({ user_message: 'zzz', reasoning_summary: 'zzz' }),
        facts,
      ),
    ).toEqual({ ok: true });
  });
});
