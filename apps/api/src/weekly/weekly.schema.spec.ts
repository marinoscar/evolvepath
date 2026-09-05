import {
  hhmm,
  isoDate,
  weekAggregatesSchema,
  weeklyPlanConstraintsSchema,
  weeklyReviewOutputSchema,
  weeklyReviewSummarySchema,
  type WeekAggregates,
} from './weekly.schema';

// =============================================================================
// The JSON columns are only as typed as this file makes them (issue #65)
// =============================================================================
//
// Postgres would happily store `completionRate: 1.2` in a jsonb column and the
// review screen would happily render "120%". These schemas are the whole
// defence, so each rule below is asserted against a value that would otherwise
// reach a user.
// =============================================================================

const zeroCounts = {
  planned: 0,
  completed: 0,
  partial: 0,
  missed: 0,
  unresolved: 0,
  skipped: 0,
  rescheduled: 0,
  started: 0,
  fallbackUsed: 0,
  minutesPlanned: 0,
  minutesSpent: 0,
  completionRate: 0,
};

function fullAggregates(): WeekAggregates {
  return {
    weekStart: '2026-08-31',
    timezone: 'America/Costa_Rica',
    coverage: {
      from: '2026-08-31T06:00:00.000Z',
      to: '2026-09-05T18:00:00.000Z',
      partial: true,
    },
    domains: {
      WORK: { ...zeroCounts, planned: 5, completed: 4, completionRate: 0.8 },
      FAMILY: { ...zeroCounts, planned: 3, completed: 2 },
      HEALTH: { ...zeroCounts, planned: 3, completed: 2, fallbackUsed: 1 },
    },
    totals: { ...zeroCounts, planned: 11, completed: 8 },
    timeWindows: [{ window: 'morning', planned: 5, completed: 4, successRate: 0.8 }],
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      planned: 0,
      completed: 0,
    })),
    rescheduleLeaders: [
      {
        commitmentId: '3f1d9a2c-6f5f-4f6a-9a3f-0d5e2a8b1c44',
        title: 'Strength workout',
        domain: 'HEALTH',
        rescheduleCount: 2,
      },
    ],
    focusStarts: { planned: 5, started: 4, completed: 4 },
    workouts: { planned: 3, completed: 2, fallbackUsed: 1, sessionsLogged: 0 },
    frictionTags: [{ tag: 'BAD_TIMING', count: 2 }],
  };
}

describe('weekAggregatesSchema', () => {
  it('accepts a fully populated week', () => {
    expect(weekAggregatesSchema.parse(fullAggregates())).toEqual(fullAggregates());
  });

  it('rejects a completion rate above 1', () => {
    const bad = fullAggregates();
    bad.domains.WORK.completionRate = 1.2;

    expect(weekAggregatesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a weekdays array that is not seven long', () => {
    const bad = fullAggregates();
    bad.weekdays = bad.weekdays.slice(0, 6);

    expect(weekAggregatesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects more than five reschedule leaders', () => {
    const bad = fullAggregates();
    bad.rescheduleLeaders = Array.from({ length: 6 }, () => ({
      commitmentId: '3f1d9a2c-6f5f-4f6a-9a3f-0d5e2a8b1c44',
      title: 'Strength workout',
      domain: 'HEALTH' as const,
      rescheduleCount: 1,
    }));

    expect(weekAggregatesSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-integer count', () => {
    const bad = fullAggregates();
    bad.totals.planned = 4.5;

    expect(weekAggregatesSchema.safeParse(bad).success).toBe(false);
  });
});

describe('weeklyReviewOutputSchema', () => {
  const move = {
    op: 'move' as const,
    target: { type: 'routine' as const, id: '9c3a1e77-1b6d-4a3e-9f1a-0b2c3d4e5f60' },
    before: { preferredTime: '18:30' },
    after: { preferredTime: '09:00' },
    reason: 'Evening sessions were moved twice; mornings held.',
  };

  const valid = {
    whatWorked: ['Morning focus blocks: 4 of 5 done'],
    whatDidNot: ['Evening workouts were moved twice'],
    patterns: [
      {
        observation: '4 of 5 morning commitments were completed',
        inference: 'Plans after 18:00 are less reliable',
        recommendation: 'Move the Wednesday workout to Saturday morning',
        confidence: 0.8,
        domain: 'HEALTH' as const,
      },
    ],
    proposedChanges: [
      {
        planId: '2a7c9f10-4b3d-4d1e-8c9a-7f6e5d4c3b21',
        summary: 'Move Wednesday workout to Saturday morning',
        changes: [move],
      },
    ],
    keepUnchanged: ['Morning focus block routine'],
    doNotAddYet: ['Do not add a second workout day yet'],
  };

  it('accepts the six outputs', () => {
    expect(weeklyReviewOutputSchema.parse(valid)).toBeTruthy();
  });

  it('rejects a pattern with no observation', () => {
    const bad = { ...valid, patterns: [{ ...valid.patterns[0], observation: '' }] };

    expect(weeklyReviewOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a proposed change with no changes', () => {
    const bad = {
      ...valid,
      proposedChanges: [{ ...valid.proposedChanges[0], changes: [] }],
    };

    expect(weeklyReviewOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a planId that is not a uuid', () => {
    const bad = {
      ...valid,
      proposedChanges: [{ ...valid.proposedChanges[0], planId: 'health-plan' }],
    };

    expect(weeklyReviewOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('applies planChangeSchema rather than a second copy of it', () => {
    // A `reduce` that raises the duration is rejected by E06-04's schema. That
    // it is rejected HERE is the assertion: it proves this file imports the
    // change vocabulary instead of restating it.
    const bad = {
      ...valid,
      proposedChanges: [
        {
          ...valid.proposedChanges[0],
          changes: [
            {
              op: 'reduce' as const,
              target: { type: 'routine' as const, id: '9c3a1e77-1b6d-4a3e-9f1a-0b2c3d4e5f60' },
              before: { estimatedDurationMin: 20 },
              after: { estimatedDurationMin: 40 },
              reason: 'More is better',
            },
          ],
        },
      ],
    };

    expect(weeklyReviewOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('carries the source and prompt version once stored', () => {
    const stored = weeklyReviewSummarySchema.parse({
      ...valid,
      source: 'template',
      promptVersion: null,
      generatedAt: '2026-09-05T18:00:00.000Z',
    });

    expect(stored.source).toBe('template');
    expect(stored.promptVersion).toBeNull();
  });
});

describe('weeklyPlanConstraintsSchema', () => {
  it('defaults the lists to empty and the notes to null', () => {
    expect(weeklyPlanConstraintsSchema.parse({})).toEqual({
      travelDays: [],
      fixedEvents: [],
      notes: null,
    });
  });

  it('rejects an unpadded date', () => {
    expect(
      weeklyPlanConstraintsSchema.safeParse({ travelDays: ['2026-9-1'] }).success,
    ).toBe(false);
  });

  it('accepts a whole-day fixed event (both times null)', () => {
    const parsed = weeklyPlanConstraintsSchema.parse({
      fixedEvents: [
        { date: '2026-09-09', title: 'Travel', startTime: null, endTime: null },
      ],
    });

    expect(parsed.fixedEvents[0].startTime).toBeNull();
  });
});

describe('the two string formats', () => {
  it.each(['2026-09-01', '2026-12-31'])('isoDate accepts %s', (value) => {
    expect(isoDate.safeParse(value).success).toBe(true);
  });

  it.each(['2026-9-1', '26-09-01', '2026-09-01T00:00:00Z', ''])(
    'isoDate rejects %s',
    (value) => {
      expect(isoDate.safeParse(value).success).toBe(false);
    },
  );

  it.each(['00:00', '09:30', '23:59'])('hhmm accepts %s', (value) => {
    expect(hhmm.safeParse(value).success).toBe(true);
  });

  it.each(['24:00', '9:30', '23:60', '17:00:00'])('hhmm rejects %s', (value) => {
    expect(hhmm.safeParse(value).success).toBe(false);
  });
});
