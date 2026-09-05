import {
  INTERVENTION_TYPES,
  coachReplySchema,
  type CoachReply,
} from './coach-reply.contract';

// =============================================================================
// The coaching contract (issue #70)
// =============================================================================
//
// The bounds here are not cosmetic. `user_message` at 600 characters is PRD
// §67's four sentences made enforceable, and `reasoning_summary` at 400 is
// what stops "why this?" from quietly becoming a transcript of the model's
// working — which PRD §16/§88 say is never stored and never shown.
// =============================================================================

const valid: CoachReply = {
  intervention_type: 'ACTIVATION_REDUCTION',
  reasoning_summary:
    'Wednesday evening has been missed three weeks running, and the two you kept were mornings.',
  user_message:
    "Wednesday evenings keep slipping. Want to try ten minutes on Saturday morning instead?",
  recommended_action: {
    title: 'Ten-minute mobility',
    duration_minutes: 10,
    commitmentId: '11111111-1111-4111-8111-111111111111',
  },
  fallback_action: null,
  proposal: null,
  friction_question: null,
};

const parse = (over: Record<string, unknown> = {}) =>
  coachReplySchema.safeParse({ ...valid, ...over });

describe('coachReplySchema (#70)', () => {
  it('accepts a well-formed reply', () => {
    expect(parse().success).toBe(true);
  });

  it('accepts every declared intervention type', () => {
    for (const type of INTERVENTION_TYPES) {
      expect(parse({ intervention_type: type }).success).toBe(true);
    }
  });

  it('rejects an intervention type nobody declared', () => {
    // E11 groups telemetry on these strings; an unrecognised one is a category
    // that exists in the data and nowhere else.
    expect(parse({ intervention_type: 'ENCOURAGE' }).success).toBe(false);
  });

  it('rejects a user_message longer than four sentences worth', () => {
    expect(parse({ user_message: 'x'.repeat(601) }).success).toBe(false);
  });

  it('rejects a reasoning_summary long enough to be a transcript', () => {
    expect(parse({ reasoning_summary: 'x'.repeat(401) }).success).toBe(false);
  });

  it('rejects an empty message or summary', () => {
    expect(parse({ user_message: '' }).success).toBe(false);
    expect(parse({ reasoning_summary: '' }).success).toBe(false);
  });

  describe('proposal', () => {
    const proposal = {
      kind: 'plan_change',
      planId: '22222222-2222-4222-8222-222222222222',
      summary: 'Move the Wednesday workout to Saturday morning.',
      changes: [
        {
          op: 'move',
          target: { type: 'routine', id: '33333333-3333-4333-8333-333333333333' },
          before: null,
          after: { preferredTime: '09:00' },
          reason: 'Wednesday evenings stopped working',
        },
      ],
    };

    it('accepts a proposal carrying at least one change', () => {
      expect(parse({ proposal }).success).toBe(true);
    });

    it('rejects a proposal with no changes', () => {
      expect(parse({ proposal: { ...proposal, changes: [] } }).success).toBe(false);
    });

    it('applies the E06-04 per-op rules to each change', () => {
      // The contract imports `planChangeSchema` rather than restating it, so a
      // "reduce" that increases the duration is refused here too.
      expect(
        parse({
          proposal: {
            ...proposal,
            changes: [
              {
                ...proposal.changes[0],
                op: 'reduce',
                before: { estimatedDurationMin: 20 },
                after: { estimatedDurationMin: 40 },
              },
            ],
          },
        }).success,
      ).toBe(false);
    });
  });

  it('requires nulls rather than omissions for the optional halves', () => {
    // The gateway emits `strict: true` schemas where every property is
    // required, so `.nullable()` is the shape that round-trips. An omitted key
    // must therefore fail here, or it would fail at the provider instead.
    const { proposal: _p, ...withoutProposal } = valid;
    expect(coachReplySchema.safeParse(withoutProposal).success).toBe(false);
  });
});
