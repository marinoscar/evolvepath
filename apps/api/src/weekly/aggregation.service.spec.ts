import { aggregateWeek, type AggregationInput } from './aggregation.service';
import {
  buildFixtureWeek,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_WEEK_START,
} from './__fixtures__/week-fixture';
import { localTimeToInstant } from './week-bounds';
import { weekAggregatesSchema } from './weekly.schema';

// =============================================================================
// The counting rules, asserted one at a time (issue #73)
// =============================================================================
//
// These numbers are quoted in the epic's acceptance criteria and are what the
// review screen renders. Each `describe` below is one rule from the service
// header, and each is a rule that a plausible implementation gets wrong.
// =============================================================================

const OPTIONS = {
  now: FIXTURE_NOW,
  timeZone: FIXTURE_TIME_ZONE,
  weekStart: FIXTURE_WEEK_START,
};

function emptyInput(): AggregationInput {
  return {
    commitments: [],
    evidence: [],
    reflections: [],
    focusSessions: [],
    workoutSessions: [],
  };
}

describe('aggregateWeek on the epic-script week', () => {
  const result = aggregateWeek(buildFixtureWeek(), OPTIONS);

  it('counts WORK as five planned, four completed, one skipped', () => {
    expect(result.domains.WORK).toMatchObject({
      planned: 5,
      completed: 4,
      skipped: 1,
      missed: 0,
      unresolved: 0,
      completionRate: 0.8,
    });
  });

  it('counts FAMILY as three planned, two completed, one skipped', () => {
    expect(result.domains.FAMILY).toMatchObject({ planned: 3, completed: 2, skipped: 1 });
  });

  // Rule 1. Three HEALTH rows carry the same intention on Wednesday/Thursday/
  // Friday: two closed RESCHEDULED originals and one live row. Counting them
  // all would report five workouts intended where the user intended three.
  it('counts a rescheduled intention once, and its closed originals separately', () => {
    expect(result.domains.HEALTH.planned).toBe(3);
    expect(result.domains.HEALTH.rescheduled).toBe(2);
  });

  it('counts the minimum version as a completion and as a fallback', () => {
    expect(result.domains.HEALTH.completed).toBe(2);
    expect(result.domains.HEALTH.fallbackUsed).toBe(1);
    expect(result.workouts).toMatchObject({ planned: 3, completed: 2, fallbackUsed: 1 });
  });

  it('names the moved commitment as the reschedule leader, live row only', () => {
    expect(result.rescheduleLeaders).toHaveLength(1);
    expect(result.rescheduleLeaders[0]).toMatchObject({
      title: 'Strength workout',
      domain: 'HEALTH',
      rescheduleCount: 2,
    });
  });

  it('buckets by local hour: mornings 4 of 5, evenings 2 of 6', () => {
    const byWindow = Object.fromEntries(result.timeWindows.map((w) => [w.window, w]));

    expect(byWindow.morning).toMatchObject({ planned: 5, completed: 4, successRate: 0.8 });
    // Three HEALTH (18:30) plus three FAMILY (19:00) are planned in the
    // evening; four of those six were completed.
    expect(byWindow.evening).toMatchObject({ planned: 6, completed: 4 });
  });

  it('reports the week as partial until its last local midnight', () => {
    expect(result.coverage.partial).toBe(true);
    expect(result.coverage.to).toBe(FIXTURE_NOW.toISOString());
  });

  it('counts every friction tag across day and commitment reflections', () => {
    expect(result.frictionTags).toEqual([
      { tag: 'BAD_TIMING', count: 2 },
      { tag: 'TOO_MUCH', count: 1 },
    ]);
  });

  it('reports WORK focus starts', () => {
    expect(result.focusStarts).toEqual({ planned: 5, started: 4, completed: 4 });
  });

  it('satisfies its own schema', () => {
    expect(weekAggregatesSchema.safeParse(result).success).toBe(true);
  });
});

describe('completion rate', () => {
  it('weighs a partial completion as half', () => {
    const input = emptyInput();
    input.commitments = [
      row('WORK', 'A', '2026-08-31', '09:00', 'COMPLETED'),
      row('WORK', 'B', '2026-09-01', '09:00', 'PARTIALLY_COMPLETED'),
      row('WORK', 'C', '2026-09-02', '09:00', 'SKIPPED'),
      row('WORK', 'D', '2026-09-03', '09:00', 'SKIPPED'),
    ];

    // (1 + 0.5) / 4
    expect(aggregateWeek(input, OPTIONS).domains.WORK.completionRate).toBe(0.38);
  });

  it('is zero rather than NaN for a domain with nothing planned', () => {
    expect(aggregateWeek(emptyInput(), OPTIONS).domains.HEALTH.completionRate).toBe(0);
  });
});

// Rule 2. A Friday review must not report Saturday's workout as anything.
describe('the future', () => {
  it('excludes rows scheduled after now, and says the week is partial', () => {
    const input = emptyInput();
    input.commitments = [
      row('HEALTH', 'Done', '2026-09-01', '09:00', 'COMPLETED'),
      row('HEALTH', 'Still to come', '2026-09-06', '09:00', 'PLANNED'),
    ];

    // Wednesday lunchtime: Sunday's workout has not happened and must not be
    // reported at all — not as planned, and certainly not as unresolved.
    const result = aggregateWeek(input, {
      ...OPTIONS,
      now: new Date('2026-09-02T18:00:00.000Z'),
    });

    expect(result.domains.HEALTH.planned).toBe(1);
    expect(result.domains.HEALTH.unresolved).toBe(0);
    expect(result.coverage.partial).toBe(true);
  });

  it('covers the whole week once it is over', () => {
    const input = emptyInput();
    input.commitments = [row('HEALTH', 'Done', '2026-09-06', '09:00', 'COMPLETED')];

    const result = aggregateWeek(input, {
      ...OPTIONS,
      now: new Date('2026-09-08T12:00:00.000Z'),
    });

    expect(result.coverage.partial).toBe(false);
    expect(result.domains.HEALTH.planned).toBe(1);
  });
});

// Rule 3. Nothing marks a stale row MISSED until E11-02, and calling an
// untouched intention a miss is the product inventing a failure.
describe('unresolved versus missed', () => {
  it('reports a past PLANNED row as unresolved, never as missed', () => {
    const input = emptyInput();
    input.commitments = [row('WORK', 'Nobody touched it', '2026-09-01', '09:00', 'PLANNED')];

    const result = aggregateWeek(input, OPTIONS);

    expect(result.domains.WORK).toMatchObject({ unresolved: 1, missed: 0, planned: 1 });
  });

  it('reports an explicitly MISSED row as missed and not as unresolved', () => {
    const input = emptyInput();
    input.commitments = [row('WORK', 'Marked missed', '2026-09-01', '09:00', 'MISSED')];

    expect(aggregateWeek(input, OPTIONS).domains.WORK).toMatchObject({
      missed: 1,
      unresolved: 0,
    });
  });
});

describe('cancelled rows', () => {
  it('counts a cancelled commitment as nothing at all', () => {
    const input = emptyInput();
    input.commitments = [row('FAMILY', 'Called off', '2026-09-01', '19:00', 'CANCELLED')];

    expect(aggregateWeek(input, OPTIONS).domains.FAMILY).toMatchObject({
      planned: 0,
      completed: 0,
      skipped: 0,
    });
  });
});

describe('an empty week', () => {
  const result = aggregateWeek(emptyInput(), OPTIONS);

  it('is all zeroes with seven weekdays and six windows', () => {
    expect(result.totals.planned).toBe(0);
    expect(result.weekdays).toHaveLength(7);
    expect(result.timeWindows).toHaveLength(6);
    expect(result.rescheduleLeaders).toEqual([]);
    expect(result.frictionTags).toEqual([]);
  });
});

describe('purity', () => {
  it('returns the same result twice and does not mutate its input', () => {
    const input = buildFixtureWeek();
    const snapshot = JSON.stringify(input);

    const first = aggregateWeek(input, OPTIONS);
    const second = aggregateWeek(input, OPTIONS);

    expect(first).toEqual(second);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

function row(
  domain: 'WORK' | 'FAMILY' | 'HEALTH',
  title: string,
  date: string,
  time: string,
  status: string,
) {
  return {
    id: `00000000-0000-4000-8000-${title.length.toString().padStart(12, '0')}`,
    domain,
    title,
    status,
    scheduledStart: localTimeToInstant(date, time, FIXTURE_TIME_ZONE),
    scheduledEnd: null,
    rescheduleCount: 0,
    routineId: null,
    versionUsed: null,
    startedAt: null,
    minutesSpent: null,
    estimatedMinutes: 30,
  } as AggregationInput['commitments'][number];
}
