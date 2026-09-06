import { MAX_SESSIONS_PER_DAY, validateWorkSessionPlan } from './work-session-plan.guardrails';
import type { WorkSessionPlan } from './work-session-plan.schema';

// =============================================================================
// The guardrails (issue #108)
// =============================================================================
//
// These rules exist because the model can produce a plan that is shaped
// perfectly and is still not a week anybody can work — three sessions on a
// Tuesday, a session after the deadline, a "minimum start" longer than the
// session it is the minimum of.
// =============================================================================

const NOW = new Date('2026-09-07T08:00:00.000Z'); // Monday
const CTX = {
  now: NOW,
  timezone: 'UTC',
  targetDate: '2026-09-18' as string | null,
  availableMinutesPerDay: 60,
};

function session(overrides: Partial<WorkSessionPlan['sessions'][number]> = {}) {
  return {
    title: 'Storyline: decision, recommendation, three arguments',
    scheduledStart: '2026-09-08T09:00:00.000Z',
    durationMinutes: 25,
    milestoneIndex: 0,
    minimumStart: { title: 'Write the decision sentence', minutes: 10 },
    ...overrides,
  };
}

function plan(overrides: Partial<WorkSessionPlan> = {}): WorkSessionPlan {
  return {
    milestones: [{ title: 'Storyline exists', order: 0 }],
    sessions: [session()],
    implementationIntention: { when: 'After coffee', then: 'I open the deck' },
    reviewCadence: 'WEEKLY',
    rationale: 'Mornings.',
    ...overrides,
  };
}

describe('validateWorkSessionPlan', () => {
  it('accepts a plan that fits', () => {
    expect(validateWorkSessionPlan(plan(), CTX)).toEqual([]);
  });

  it('rejects milestone orders with a gap', () => {
    const details = validateWorkSessionPlan(
      plan({
        milestones: [
          { title: 'A', order: 0 },
          { title: 'B', order: 2 },
        ],
      }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/no gaps/i);
  });

  it('rejects a session pointing past the end of the milestone list', () => {
    const details = validateWorkSessionPlan(
      plan({ sessions: [session({ milestoneIndex: 3 })] }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/only 1/);
  });

  it('rejects a session in the past', () => {
    const details = validateWorkSessionPlan(
      plan({ sessions: [session({ scheduledStart: '2026-09-01T09:00:00.000Z' })] }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/in the past/i);
  });

  it('accepts a session earlier today — a plan must not expire while it is read', () => {
    expect(
      validateWorkSessionPlan(
        plan({ sessions: [session({ scheduledStart: '2026-09-07T06:00:00.000Z' })] }),
        CTX,
      ),
    ).toEqual([]);
  });

  it('rejects a session after the target date', () => {
    const details = validateWorkSessionPlan(
      plan({ sessions: [session({ scheduledStart: '2026-09-25T09:00:00.000Z' })] }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/after the target date/i);
  });

  it('rejects a session beyond the default horizon when there is no target date', () => {
    const details = validateWorkSessionPlan(
      plan({ sessions: [session({ scheduledStart: '2026-09-30T09:00:00.000Z' })] }),
      { ...CTX, targetDate: null },
    );

    expect(details.join(' ')).toMatch(/set a target date/i);
  });

  it(`rejects more than ${MAX_SESSIONS_PER_DAY} sessions on one local day`, () => {
    const details = validateWorkSessionPlan(
      plan({
        sessions: [
          session({ scheduledStart: '2026-09-08T09:00:00.000Z', durationMinutes: 15 }),
          session({ scheduledStart: '2026-09-08T11:00:00.000Z', durationMinutes: 15 }),
          session({ scheduledStart: '2026-09-08T14:00:00.000Z', durationMinutes: 15 }),
        ],
      }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/at most 2 fit in a day/i);
  });

  it('rejects a day that exceeds the stated daily minutes', () => {
    const details = validateWorkSessionPlan(
      plan({
        sessions: [
          session({ scheduledStart: '2026-09-08T09:00:00.000Z', durationMinutes: 45 }),
          session({ scheduledStart: '2026-09-08T13:00:00.000Z', durationMinutes: 45 }),
        ],
      }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/90 minutes planned on 2026-09-08/);
  });

  it('counts days in the USER\'s zone, not UTC', () => {
    // 23:30 UTC on the 8th is 08:30 on the 9th in Tokyo, so these are two days
    // there and would be one long day in UTC.
    const sessions = [
      session({ scheduledStart: '2026-09-08T23:30:00.000Z', durationMinutes: 45 }),
      session({ scheduledStart: '2026-09-09T23:30:00.000Z', durationMinutes: 45 }),
    ];

    expect(
      validateWorkSessionPlan(plan({ sessions }), { ...CTX, timezone: 'Asia/Tokyo' }),
    ).toEqual([]);
  });

  it('rejects sessions listed out of order', () => {
    const details = validateWorkSessionPlan(
      plan({
        sessions: [
          session({ scheduledStart: '2026-09-10T09:00:00.000Z' }),
          session({ scheduledStart: '2026-09-08T09:00:00.000Z' }),
        ],
      }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/ascending order/i);
  });

  it('rejects a minimum start that is not smaller than its session', () => {
    const details = validateWorkSessionPlan(
      plan({
        sessions: [
          session({
            durationMinutes: 10,
            minimumStart: { title: 'Open it', minutes: 10 },
          }),
        ],
      }),
      CTX,
    );

    expect(details.join(' ')).toMatch(/not smaller than the session/i);
  });

  it('is pure: the same input twice gives the same details', () => {
    const p = plan({ sessions: [session({ milestoneIndex: 9 })] });

    expect(validateWorkSessionPlan(p, CTX)).toEqual(validateWorkSessionPlan(p, CTX));
  });
});
