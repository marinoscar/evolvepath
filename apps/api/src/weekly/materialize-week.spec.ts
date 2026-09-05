import { DEFAULT_TIME, materializeWeek, type RoutineForWeek } from './materialize-week';
import type { ExtraCommitment, WeeklyPlanConstraints } from './weekly.schema';

// =============================================================================
// Turning routines into next week (issue #80)
// =============================================================================
//
// 2026-09-07 is a Monday. The week runs Mon 07 → Sun 13.
// =============================================================================

const WEEK = '2026-09-07';

const MONDAY = '2026-09-07';
const TUESDAY = '2026-09-08';
const WEDNESDAY = '2026-09-09';
const THURSDAY = '2026-09-10';
const FRIDAY = '2026-09-11';
const SATURDAY = '2026-09-12';
const SUNDAY = '2026-09-13';

function routine(over: Partial<RoutineForWeek> = {}): RoutineForWeek {
  return {
    id: 'routine-1',
    title: 'Strength workout',
    domain: 'HEALTH',
    frequency: 'CUSTOM',
    daysOfWeek: [1, 3, 6],
    preferredTime: '18:30',
    estimatedDurationMin: 40,
    minimumDurationMin: 15,
    fallbackBehavior: '10-minute circuit',
    planVersionId: '2a7c9f10-4b3d-4d1e-8c9a-7f6e5d4c3b21',
    outcomeId: '9c3a1e77-1b6d-4a3e-9f1a-0b2c3d4e5f60',
    ...over,
  };
}

const noConstraints: WeeklyPlanConstraints = {
  travelDays: [],
  fixedEvents: [],
  notes: null,
};

function run(over: Partial<Parameters<typeof materializeWeek>[0]> = {}) {
  return materializeWeek({
    weekStart: WEEK,
    routines: [routine()],
    domainModes: {},
    constraints: noConstraints,
    extras: [],
    existing: [],
    ...over,
  });
}

describe('occurrence days per frequency', () => {
  const datesFor = (frequency: RoutineForWeek['frequency'], daysOfWeek: number[] = []) =>
    run({ routines: [routine({ frequency, daysOfWeek })] }).map((item) => item.date);

  it('DAILY is all seven days', () => {
    expect(datesFor('DAILY')).toEqual([
      MONDAY,
      TUESDAY,
      WEDNESDAY,
      THURSDAY,
      FRIDAY,
      SATURDAY,
      SUNDAY,
    ]);
  });

  it('WEEKDAYS is Monday to Friday', () => {
    expect(datesFor('WEEKDAYS')).toEqual([MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]);
  });

  it('WEEKENDS is Saturday and Sunday', () => {
    expect(datesFor('WEEKENDS')).toEqual([SATURDAY, SUNDAY]);
  });

  it('WEEKLY uses the earliest named day', () => {
    expect(datesFor('WEEKLY', [4, 2])).toEqual([TUESDAY]);
  });

  it('WEEKLY with no named day falls back to Monday', () => {
    // A weekly routine with no day is a rule with a hole in it, and the start
    // of the week is the least surprising place to put it.
    expect(datesFor('WEEKLY')).toEqual([MONDAY]);
  });

  it('CUSTOM uses exactly the named days', () => {
    expect(datesFor('CUSTOM', [1, 3, 6])).toEqual([MONDAY, WEDNESDAY, SATURDAY]);
  });

  it('CUSTOM with no days produces nothing', () => {
    expect(datesFor('CUSTOM', [])).toEqual([]);
  });
});

describe('times and versions', () => {
  it('uses the routine’s preferred time', () => {
    expect(run()[0].startTime).toBe('18:30');
  });

  it.each([
    ['WORK', DEFAULT_TIME.WORK],
    ['FAMILY', DEFAULT_TIME.FAMILY],
    ['HEALTH', DEFAULT_TIME.HEALTH],
  ] as const)('falls back to the %s default when none is set', (domain, expected) => {
    const [item] = run({
      routines: [routine({ domain, preferredTime: null, frequency: 'WEEKLY', daysOfWeek: [1] })],
    });

    expect(item.startTime).toBe(expected);
  });

  it('uses the fallback behaviour as the minimum version', () => {
    expect(run()[0].minimumVersion).toBe('10-minute circuit');
  });

  it('describes the minimum by its duration when there is no fallback text', () => {
    const [item] = run({ routines: [routine({ fallbackBehavior: null })] });

    expect(item.minimumVersion).toBe('15-minute version');
  });

  it('leaves the short version null — a routine has two sizes, not three', () => {
    expect(run()[0].shortVersion).toBeNull();
  });
});

describe('exclusions', () => {
  it('marks a travel day rather than dropping it', () => {
    const items = run({
      constraints: { ...noConstraints, travelDays: [WEDNESDAY] },
    });

    const wednesday = items.find((item) => item.date === WEDNESDAY);

    // Present, so the wizard can grey it out and say why. A silently missing
    // Wednesday is indistinguishable from one the product forgot.
    expect(wednesday).toBeDefined();
    expect(wednesday).toMatchObject({ include: false, excludedBy: 'travel_day' });
  });

  it('excludes an occurrence that overlaps a timed fixed event', () => {
    // The workout runs 18:30–19:10; the dinner runs 19:00–20:00.
    const items = run({
      constraints: {
        ...noConstraints,
        fixedEvents: [
          { date: MONDAY, title: 'Dinner out', startTime: '19:00', endTime: '20:00' },
        ],
      },
    });

    expect(items.find((item) => item.date === MONDAY)).toMatchObject({
      excludedBy: 'fixed_event',
    });
  });

  it('keeps an occurrence that does not overlap', () => {
    const items = run({
      constraints: {
        ...noConstraints,
        fixedEvents: [{ date: MONDAY, title: 'Dentist', startTime: '10:00', endTime: '11:00' }],
      },
    });

    expect(items.find((item) => item.date === MONDAY)).toMatchObject({
      include: true,
      excludedBy: null,
    });
  });

  it('treats an event with no times as blocking the whole day', () => {
    // The user typed it without a clock because they do not know, and guessing
    // "probably an hour" would let the product schedule into it.
    const items = run({
      constraints: {
        ...noConstraints,
        fixedEvents: [{ date: SATURDAY, title: 'Wedding', startTime: null, endTime: null }],
      },
    });

    expect(items.find((item) => item.date === SATURDAY)).toMatchObject({
      excludedBy: 'fixed_event',
    });
  });

  it('excludes every occurrence in a paused domain', () => {
    const items = run({ domainModes: { HEALTH: 'PAUSE' } });

    expect(items.every((item) => item.excludedBy === 'paused_domain')).toBe(true);
    expect(items.every((item) => item.include === false)).toBe(true);
  });

  it('does not exclude for a domain in RECOVER — that is a posture, not a stop', () => {
    expect(run({ domainModes: { HEALTH: 'RECOVER' } }).every((i) => i.include)).toBe(true);
  });
});

describe('idempotency', () => {
  it('omits an occurrence that already exists', () => {
    const items = run({ existing: [{ routineId: 'routine-1', date: WEDNESDAY }] });

    // Not "excluded" — it is not a proposal at all any more.
    expect(items.map((item) => item.date)).toEqual([MONDAY, SATURDAY]);
  });

  it('ignores an existing commitment with no routine', () => {
    const items = run({ existing: [{ routineId: null, date: MONDAY }] });

    expect(items.map((item) => item.date)).toEqual([MONDAY, WEDNESDAY, SATURDAY]);
  });
});

describe('extras', () => {
  const extra = (over: Partial<ExtraCommitment> = {}): ExtraCommitment => ({
    domain: 'FAMILY',
    title: 'Call mum',
    date: TUESDAY,
    startTime: '19:00',
    estimatedMinutes: 30,
    minimumVersion: null,
    recurring: false,
    ...over,
  });

  it('appends them with stable extra: keys', () => {
    const items = run({ extras: [extra(), extra({ date: THURSDAY })] });
    const keys = items.filter((item) => item.source === 'extra').map((item) => item.key);

    expect(keys).toEqual(['extra:0', 'extra:1']);
  });

  it('does not second-guess an extra on a travel day', () => {
    // The user typed it while looking at the same week; they can see the
    // travel day on the screen.
    const items = run({
      extras: [extra({ date: WEDNESDAY })],
      constraints: { ...noConstraints, travelDays: [WEDNESDAY] },
    });

    expect(items.find((item) => item.source === 'extra')).toMatchObject({
      include: true,
      excludedBy: null,
    });
  });
});

describe('ordering and determinism', () => {
  it('sorts by date, then time, then domain, then title', () => {
    const items = run({
      routines: [
        routine({ id: 'a', title: 'Zebra', frequency: 'WEEKLY', daysOfWeek: [1], preferredTime: '09:00' }),
        routine({ id: 'b', title: 'Apple', frequency: 'WEEKLY', daysOfWeek: [1], preferredTime: '09:00' }),
        routine({ id: 'c', title: 'Early', frequency: 'WEEKLY', daysOfWeek: [1], preferredTime: '07:00' }),
      ],
    });

    expect(items.map((item) => item.title)).toEqual(['Early', 'Apple', 'Zebra']);
  });

  it('produces the same list twice', () => {
    // The wizard re-proposes on every edit; a list that reordered itself would
    // move the checkbox the user was reaching for.
    expect(run()).toEqual(run());
  });
});

describe('a DST week', () => {
  it('still has seven distinct dates', () => {
    // Materialisation is calendar arithmetic; the instants are resolved at
    // approve, which is where the timezone lives.
    const items = run({
      weekStart: '2026-03-23',
      routines: [routine({ frequency: 'DAILY' })],
    });

    expect(new Set(items.map((item) => item.date)).size).toBe(7);
    expect(items.at(-1)?.date).toBe('2026-03-29');
  });
});
