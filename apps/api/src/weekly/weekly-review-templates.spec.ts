import { buildTemplateSummary } from './weekly-review-templates';
import { aggregateWeek } from './aggregation.service';
import {
  buildFixtureWeek,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_WEEK_START,
} from './__fixtures__/week-fixture';
import { weeklyReviewOutputSchema, type WeekAggregates } from './weekly.schema';

// =============================================================================
// The review that ships during every outage (issue #73)
// =============================================================================
//
// This copy reaches users whenever the provider is down, so it is asserted the
// way user-facing copy is asserted: on the actual sentences, and on the fact
// that none of them shame anybody.
// =============================================================================

const AGGREGATES = aggregateWeek(buildFixtureWeek(), {
  now: FIXTURE_NOW,
  timeZone: FIXTURE_TIME_ZONE,
  weekStart: FIXTURE_WEEK_START,
});

describe('buildTemplateSummary on the epic-script week', () => {
  const summary = buildTemplateSummary(AGGREGATES, { softCap: 8 });

  it('never proposes a plan change', () => {
    // A template cannot judge whether a plan should change, and a change built
    // by a string builder would be indistinguishable, inside the mutation
    // protocol, from one a coach reasoned about.
    expect(summary.proposedChanges).toEqual([]);
  });

  it('names the domains that are holding, in numbers', () => {
    expect(summary.whatWorked).toContain('Work: 4 of 5 done.');
  });

  it('names the moved commitment', () => {
    expect(summary.whatDidNot).toContain('“Strength workout” was moved 2 times.');
  });

  it('names the most common friction tag', () => {
    expect(summary.whatDidNot).toContain('“BAD_TIMING” came up 2 times in your notes.');
  });

  it('satisfies the reviewer output schema', () => {
    expect(weeklyReviewOutputSchema.safeParse(summary).success).toBe(true);
  });

  it('uses no shaming, comparing or grading language anywhere', () => {
    const text = JSON.stringify(summary).toLowerCase();

    for (const banned of [
      'only',
      'failed',
      'disappoint',
      'should have',
      'streak',
      'score',
      'grade',
      'better than',
      'unfortunately',
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe('the rules, one at a time', () => {
  it('reports a domain at 75% or better as working', () => {
    const summary = buildTemplateSummary(
      withDomain('HEALTH', { planned: 4, completed: 3, completionRate: 0.75 }),
      { softCap: 8 },
    );

    expect(summary.whatWorked).toContain('Health: 3 of 4 done.');
    expect(summary.keepUnchanged).toContain('Health is holding — leave it as it is.');
  });

  it('stays quiet about a domain just under the threshold', () => {
    const summary = buildTemplateSummary(
      withDomain('HEALTH', { planned: 4, completed: 2, completionRate: 0.5 }),
      { softCap: 8 },
    );

    expect(summary.whatWorked).toEqual([]);
    expect(summary.whatDidNot).toEqual([]);
  });

  it('names a struggling domain only when at least two things were planned', () => {
    const one = buildTemplateSummary(
      withDomain('WORK', { planned: 1, completed: 0, completionRate: 0 }),
      { softCap: 8 },
    );
    const two = buildTemplateSummary(
      withDomain('WORK', { planned: 2, completed: 0, completionRate: 0 }),
      { softCap: 8 },
    );

    expect(one.whatDidNot).toEqual([]);
    expect(two.whatDidNot).toContain('Work: 0 of 2 done.');
  });

  it('reports a time-of-day observation only when the gap is real', () => {
    const wide = buildTemplateSummary(withWindows(1, 0.2), { softCap: 8 });
    const narrow = buildTemplateSummary(withWindows(0.8, 0.6), { softCap: 8 });

    expect(wide.patterns).toHaveLength(1);
    expect(wide.patterns[0].observation).toContain('in the morning');
    // The template never guesses: both are null and the screen renders no row.
    expect(wide.patterns[0].inference).toBeNull();
    expect(wide.patterns[0].recommendation).toBeNull();
    expect(narrow.patterns).toEqual([]);
  });

  it('ignores a window with fewer than three data points', () => {
    const aggregates = withWindows(1, 0);
    aggregates.timeWindows = aggregates.timeWindows.map((w) =>
      w.window === 'evening' ? { ...w, planned: 2, completed: 0 } : w,
    );

    expect(buildTemplateSummary(aggregates, { softCap: 8 }).patterns).toEqual([]);
  });

  it('says nothing new this week exactly at the soft cap', () => {
    const at = base();
    at.totals.planned = 8;
    const under = base();
    under.totals.planned = 7;

    expect(buildTemplateSummary(at, { softCap: 8 }).doNotAddYet).toEqual([
      'Nothing new this week — you already have 8 commitments.',
    ]);
    expect(buildTemplateSummary(under, { softCap: 8 }).doNotAddYet).toEqual([]);
  });

  it('produces a valid, empty-ish summary for a week with nothing in it', () => {
    const summary = buildTemplateSummary(base(), { softCap: 8 });

    expect(weeklyReviewOutputSchema.safeParse(summary).success).toBe(true);
    expect(summary.whatWorked).toEqual([]);
    expect(summary.patterns).toEqual([]);
  });
});

function zeroCounts() {
  return {
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
}

function base(): WeekAggregates {
  return {
    weekStart: '2026-08-31',
    timezone: 'UTC',
    coverage: {
      from: '2026-08-31T00:00:00.000Z',
      to: '2026-09-07T00:00:00.000Z',
      partial: false,
    },
    domains: { WORK: zeroCounts(), FAMILY: zeroCounts(), HEALTH: zeroCounts() },
    totals: zeroCounts(),
    timeWindows: [],
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({ weekday, planned: 0, completed: 0 })),
    rescheduleLeaders: [],
    focusStarts: { planned: 0, started: 0, completed: 0 },
    workouts: { planned: 0, completed: 0, fallbackUsed: 0, sessionsLogged: 0 },
    frictionTags: [],
  };
}

function withDomain(
  domain: 'WORK' | 'FAMILY' | 'HEALTH',
  counts: { planned: number; completed: number; completionRate: number },
): WeekAggregates {
  const aggregates = base();
  aggregates.domains[domain] = { ...zeroCounts(), ...counts };

  return aggregates;
}

function withWindows(morning: number, evening: number): WeekAggregates {
  const aggregates = base();
  aggregates.timeWindows = [
    { window: 'morning', planned: 5, completed: Math.round(morning * 5), successRate: morning },
    { window: 'evening', planned: 5, completed: Math.round(evening * 5), successRate: evening },
  ];

  return aggregates;
}
