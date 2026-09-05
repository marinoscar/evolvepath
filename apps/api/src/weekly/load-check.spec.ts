import { checkLoad } from './load-check';
import type { ProposedCommitment } from './weekly.schema';

// =============================================================================
// "You already have eight recurring commitments" (issue #80)
// =============================================================================

function item(over: Partial<ProposedCommitment> = {}): ProposedCommitment {
  return {
    key: 'routine-1:2026-09-07',
    source: 'routine',
    include: true,
    domain: 'WORK',
    title: 'Morning focus block',
    date: '2026-09-07',
    startTime: '07:30',
    estimatedMinutes: 50,
    minimumMinutes: 10,
    routineId: '9c3a1e77-1b6d-4a3e-9f1a-0b2c3d4e5f60',
    planVersionId: '2a7c9f10-4b3d-4d1e-8c9a-7f6e5d4c3b21',
    outcomeId: null,
    fullVersion: 'Morning focus block',
    shortVersion: null,
    minimumVersion: '10-minute version',
    recurring: true,
    excludedBy: null,
    ...over,
  };
}

/** `n` distinct routines, one occurrence each. */
const routines = (n: number, over: Partial<ProposedCommitment> = {}) =>
  Array.from({ length: n }, (_, index) =>
    item({ routineId: `routine-${index}`, key: `routine-${index}:2026-09-07`, ...over }),
  );

const OPTIONS = { softCap: 8, weekdayMinutes: null };

describe('recurring count', () => {
  it('is quiet at the cap and warns above it', () => {
    expect(checkLoad(routines(8), OPTIONS).warnings).toEqual([]);

    const [warning] = checkLoad(routines(9), OPTIONS).warnings;

    expect(warning.code).toBe('RECURRING_OVER_CAP');
    // PRD §48's sentence, with the real count.
    expect(warning.message).toBe(
      'You already have 9 recurring commitments this week. ' +
        'I recommend replacing something rather than adding another habit.',
    );
    expect(warning.detail).toEqual({ recurringCount: 9, softCap: 8 });
  });

  it('counts one routine once however many days it runs on', () => {
    // Five morning focus blocks are one habit. Counting occurrences would put
    // every weekday routine over the cap on its own.
    const week = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map(
      (date) => item({ date, key: `routine-1:${date}` }),
    );

    expect(checkLoad(week, OPTIONS).summary.recurringCount).toBe(1);
  });

  it('counts a recurring extra, and ignores a one-off one', () => {
    const items = [
      item({ source: 'extra', routineId: null, recurring: true, key: 'extra:0' }),
      item({ source: 'extra', routineId: null, recurring: false, key: 'extra:1' }),
      item({ source: 'extra', routineId: null, recurring: false, key: 'extra:2' }),
    ];

    expect(checkLoad(items, OPTIONS).summary.recurringCount).toBe(1);
  });

  it('ignores excluded items entirely', () => {
    const items = [
      ...routines(8),
      ...routines(3, { include: false, excludedBy: 'travel_day' }).map((row, i) => ({
        ...row,
        routineId: `excluded-${i}`,
      })),
    ];

    expect(checkLoad(items, OPTIONS).warnings).toEqual([]);
  });
});

describe('minute capacity', () => {
  it('warns when the week exceeds five weekdays of stated time', () => {
    const items = routines(7, { estimatedMinutes: 50 });

    const { summary, warnings } = checkLoad(items, { softCap: 8, weekdayMinutes: 60 });

    expect(summary.capacityMinutes).toBe(300);
    expect(summary.estimatedMinutes).toBe(350);
    expect(warnings.map((w) => w.code)).toContain('MINUTES_OVER_CAPACITY');
    expect(warnings.find((w) => w.code === 'MINUTES_OVER_CAPACITY')?.message).toContain(
      '5h 50m',
    );
  });

  it('says nothing about capacity when the user never stated any', () => {
    const { summary, warnings } = checkLoad(routines(7, { estimatedMinutes: 200 }), OPTIONS);

    // A fabricated budget would produce a warning about a number the user
    // never gave us.
    expect(summary.capacityMinutes).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('names the single heaviest day, and only one', () => {
    const items = [
      item({ date: '2026-09-10', estimatedMinutes: 120, routineId: 'a', key: 'a' }),
      item({ date: '2026-09-10', estimatedMinutes: 60, routineId: 'b', key: 'b' }),
      item({ date: '2026-09-11', estimatedMinutes: 100, routineId: 'c', key: 'c' }),
    ];

    const dayWarnings = checkLoad(items, { softCap: 8, weekdayMinutes: 90 }).warnings.filter(
      (w) => w.code === 'DAY_OVER_CAPACITY',
    );

    // A week with three heavy days would otherwise produce three alerts
    // saying the same thing.
    expect(dayWarnings).toHaveLength(1);
    expect(dayWarnings[0].detail).toMatchObject({ date: '2026-09-10', minutes: 180 });
  });
});

describe('the summary', () => {
  it('reports every domain, including the empty ones', () => {
    const items = [
      item({ domain: 'WORK', estimatedMinutes: 50, routineId: 'a', key: 'a' }),
      item({ domain: 'HEALTH', estimatedMinutes: 40, routineId: 'b', key: 'b' }),
    ];

    expect(checkLoad(items, OPTIONS).summary.byDomain).toEqual({
      WORK: { count: 1, minutes: 50 },
      FAMILY: { count: 0, minutes: 0 },
      HEALTH: { count: 1, minutes: 40 },
    });
  });

  it('is all zeroes and warning-free for an empty week', () => {
    const { summary, warnings } = checkLoad([], OPTIONS);

    expect(summary).toMatchObject({ recurringCount: 0, estimatedMinutes: 0 });
    expect(warnings).toEqual([]);
  });

  it('echoes the cap it was checked against', () => {
    expect(checkLoad([], { softCap: 12, weekdayMinutes: null }).summary.softCap).toBe(12);
  });
});

describe('warnings are data', () => {
  it('never throws, however overloaded the week is', () => {
    // PRD §48 recommends; it does not refuse. A person who deliberately wants
    // a heavy week is not making a mistake the software should block.
    expect(() =>
      checkLoad(routines(40, { estimatedMinutes: 400 }), { softCap: 1, weekdayMinutes: 5 }),
    ).not.toThrow();
  });

  it('carries a suggestion alongside every message', () => {
    const { warnings } = checkLoad(routines(9, { estimatedMinutes: 200 }), {
      softCap: 8,
      weekdayMinutes: 30,
    });

    expect(warnings.length).toBeGreaterThan(1);
    for (const warning of warnings) {
      expect(warning.suggestion.length).toBeGreaterThan(0);
    }
  });
});
