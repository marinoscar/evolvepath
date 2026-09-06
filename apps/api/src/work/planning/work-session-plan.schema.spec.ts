import { workSessionPlanSchema } from './work-session-plan.schema';

// =============================================================================
// The contract, and the five ways a plan is not one (issue #108)
// =============================================================================
//
// The interesting assertions are the rejections. This schema is the ONE gate
// between model output and a database row, so every bound it declares is a row
// the apply transaction would otherwise have to cope with.
// =============================================================================

const valid = () => ({
  milestones: [
    { title: 'One-page storyline exists', order: 0 },
    { title: 'Draft deck exists', order: 1 },
  ],
  sessions: [
    {
      title: '25 min — storyline: decision, recommendation, three arguments',
      scheduledStart: '2026-09-08T09:00:00.000Z',
      durationMinutes: 25,
      milestoneIndex: 0,
      minimumStart: { title: 'Write the decision sentence', minutes: 10 },
    },
  ],
  implementationIntention: {
    when: 'After I sit down with coffee',
    then: 'I open the deck and start the next session',
  },
  reviewCadence: 'WEEKLY' as const,
  rationale: 'Five weekday mornings, front-loaded on the storyline.',
});

describe('workSessionPlanSchema', () => {
  it('accepts a well-formed plan', () => {
    expect(workSessionPlanSchema.safeParse(valid()).success).toBe(true);
  });

  it('rejects more than twenty sessions', () => {
    const plan = valid();
    plan.sessions = Array.from({ length: 21 }, () => plan.sessions[0]);

    expect(workSessionPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a session shorter than ten minutes', () => {
    const plan = valid();
    plan.sessions[0].durationMinutes = 5;

    expect(workSessionPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a minimum start longer than fifteen minutes', () => {
    const plan = valid();
    plan.sessions[0].minimumStart.minutes = 20;

    expect(workSessionPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a start time that is not ISO-8601 with an offset', () => {
    const plan = valid();
    plan.sessions[0].scheduledStart = '8 September, 9am';

    expect(workSessionPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a review cadence outside the three the product offers', () => {
    const plan = { ...valid(), reviewCadence: 'MONTHLY' };

    expect(workSessionPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a plan with no minimum start on a session', () => {
    const plan = valid() as Record<string, unknown>;
    delete (plan.sessions as Array<Record<string, unknown>>)[0].minimumStart;

    expect(workSessionPlanSchema.safeParse(plan).success).toBe(false);
  });
});
