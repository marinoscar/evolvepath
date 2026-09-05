import {
  addDays,
  localDateOf,
  nextOccurrences,
  weekStartLocal,
  weekStartOfDate,
  weekdayOf,
  weeksBetween,
  zonedTimeToUtc,
} from './recurrence';
import type { RitualRecurrence } from './family.schema';

/** Tue/Thu/Sun at 18:30, every week — the epic's worked example. */
const DINNER: RitualRecurrence = { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 };

describe('zonedTimeToUtc', () => {
  it('resolves a plain evening in a zone with no DST', () => {
    expect(zonedTimeToUtc('2026-06-15', '18:30', 'America/Costa_Rica').toISOString()).toBe(
      '2026-06-16T00:30:00.000Z',
    );
  });

  it('resolves a local date that is ahead of UTC', () => {
    expect(zonedTimeToUtc('2026-01-01', '00:15', 'Pacific/Auckland').toISOString()).toBe(
      '2025-12-31T11:15:00.000Z',
    );
  });

  // Spring forward: 02:30 never happens, so it is pushed forward by the gap.
  it('shifts a wall time inside the spring-forward gap forward', () => {
    expect(zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('shifts a gap forward in a zone that transitions at 01:00', () => {
    // London goes 01:00 GMT → 02:00 BST on 29 March 2026.
    expect(zonedTimeToUtc('2026-03-29', '01:30', 'Europe/London').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  // Fall back: 01:30 happens twice, and the first one wins.
  it('takes the first instant of an ambiguous wall time', () => {
    expect(zonedTimeToUtc('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('takes the first instant of an ambiguous wall time east of Greenwich', () => {
    // London goes 02:00 BST → 01:00 GMT on 25 October 2026; 00:30Z is the BST one.
    expect(zonedTimeToUtc('2026-10-25', '01:30', 'Europe/London').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  // The case a single-pass "guess and subtract" gets wrong: a perfectly
  // ordinary evening on the day the clocks changed that morning.
  it('resolves a valid wall time later on a spring-forward day', () => {
    expect(zonedTimeToUtc('2026-03-08', '18:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T22:30:00.000Z',
    );
  });

  it('handles a half-hour zone', () => {
    expect(zonedTimeToUtc('2026-06-15', '18:30', 'Asia/Kolkata').toISOString()).toBe(
      '2026-06-15T13:00:00.000Z',
    );
  });

  it('falls back to UTC for an unusable zone rather than throwing', () => {
    expect(zonedTimeToUtc('2026-06-15', '18:30', 'Mars/Olympus').toISOString()).toBe(
      '2026-06-15T18:30:00.000Z',
    );
  });
});

describe('weekStartLocal', () => {
  it('returns the current week’s Monday for a Sunday night in Auckland', () => {
    // 2026-06-07 is a Sunday. 23:30 in Auckland is 11:30Z the same day.
    const instant = new Date('2026-06-07T11:30:00.000Z');

    expect(localDateOf(instant, 'Pacific/Auckland')).toBe('2026-06-07');
    expect(weekStartLocal(instant, 'Pacific/Auckland')).toBe('2026-06-01');
  });

  it('reads the local date, not the UTC one', () => {
    // Sunday 23:30 UTC is Sunday 17:30 in Costa Rica — still the week ending.
    const instant = new Date('2026-06-07T23:30:00.000Z');

    expect(weekStartLocal(instant, 'America/Costa_Rica')).toBe('2026-06-01');
    // The same instant is already Monday in Auckland, and belongs to the next.
    expect(weekStartLocal(instant, 'Pacific/Auckland')).toBe('2026-06-08');
  });

  it('returns a Monday unchanged', () => {
    expect(weekStartOfDate('2026-06-01')).toBe('2026-06-01');
    expect(weekdayOf('2026-06-01')).toBe(1);
  });
});

describe('weeksBetween', () => {
  it('counts whole weeks forward and backward', () => {
    expect(weeksBetween('2026-06-01', '2026-06-15')).toBe(2);
    expect(weeksBetween('2026-06-15', '2026-06-01')).toBe(-2);
    expect(weeksBetween('2026-06-01', '2026-06-01')).toBe(0);
  });

  // ISO week NUMBERS wrap at the year boundary; day arithmetic does not.
  it('keeps counting across a year boundary', () => {
    expect(weeksBetween('2026-12-21', '2027-01-18')).toBe(4);
  });

  it('is unaffected by a DST change inside the span', () => {
    expect(weeksBetween('2026-03-02', '2026-03-16')).toBe(2);
  });
});

describe('addDays', () => {
  it('crosses a month and a year boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('nextOccurrences', () => {
  const CR = 'America/Costa_Rica';
  /** Monday 1 June 2026, 00:00 in Costa Rica. */
  const mondayCr = zonedTimeToUtc('2026-06-01', '00:00', CR);
  const nextMondayCr = zonedTimeToUtc('2026-06-08', '00:00', CR);

  it('yields exactly the matching days of one week, in order', () => {
    const found = nextOccurrences(DINNER, mondayCr, nextMondayCr, CR, mondayCr);

    expect(found.map((o) => o.dateLocal)).toEqual(['2026-06-02', '2026-06-04', '2026-06-07']);
    expect(found.map((o) => o.scheduledStart.toISOString())).toEqual([
      // 18:30 in Costa Rica is 00:30Z the FOLLOWING day.
      '2026-06-03T00:30:00.000Z',
      '2026-06-05T00:30:00.000Z',
      '2026-06-08T00:30:00.000Z',
    ]);
  });

  it('treats `from` as exclusive and `to` as inclusive', () => {
    const first = zonedTimeToUtc('2026-06-02', '18:30', CR);
    const last = zonedTimeToUtc('2026-06-07', '18:30', CR);

    const found = nextOccurrences(DINNER, first, last, CR, mondayCr);

    // The occurrence exactly at `from` is not repeated; the one at `to` is kept.
    expect(found.map((o) => o.dateLocal)).toEqual(['2026-06-04', '2026-06-07']);
  });

  it('returns nothing for an empty or inverted window', () => {
    expect(nextOccurrences(DINNER, nextMondayCr, mondayCr, CR, mondayCr)).toEqual([]);
    expect(nextOccurrences(DINNER, mondayCr, mondayCr, CR, mondayCr)).toEqual([]);
  });

  it('anchors a fortnightly cadence to the creation week', () => {
    const fortnightly: RitualRecurrence = { ...DINNER, everyNWeeks: 2 };
    // Wednesday 3 June 2026 — the anchor's own week is week 0.
    const anchor = zonedTimeToUtc('2026-06-03', '09:00', CR);

    const anchorWeek = nextOccurrences(
      fortnightly,
      mondayCr,
      nextMondayCr,
      CR,
      anchor,
    );
    const weekOne = nextOccurrences(
      fortnightly,
      nextMondayCr,
      zonedTimeToUtc('2026-06-15', '00:00', CR),
      CR,
      anchor,
    );
    const weekTwo = nextOccurrences(
      fortnightly,
      zonedTimeToUtc('2026-06-15', '00:00', CR),
      zonedTimeToUtc('2026-06-22', '00:00', CR),
      CR,
      anchor,
    );

    expect(anchorWeek).toHaveLength(3);
    expect(weekOne).toHaveLength(0);
    expect(weekTwo).toHaveLength(3);
  });

  it('keeps a four-week cadence across a year boundary', () => {
    const monthly: RitualRecurrence = { weekdays: [1], time: '17:00', everyNWeeks: 4 };
    // Monday 21 December 2026.
    const anchor = zonedTimeToUtc('2026-12-21', '09:00', CR);

    const dates = nextOccurrences(
      monthly,
      zonedTimeToUtc('2026-12-20', '00:00', CR),
      zonedTimeToUtc('2027-02-22', '00:00', CR),
      CR,
      anchor,
    ).map((o) => o.dateLocal);

    // Four weeks apart throughout — ISO week numbers reset in between.
    expect(dates).toEqual(['2026-12-21', '2027-01-18', '2027-02-15']);
  });

  it('yields exactly one occurrence per matching day across a spring-forward', () => {
    const NY = 'America/New_York';
    const daily: RitualRecurrence = { weekdays: [0, 1, 2, 3, 4, 5, 6], time: '07:00', everyNWeeks: 1 };
    const anchor = zonedTimeToUtc('2026-03-02', '09:00', NY);

    const found = nextOccurrences(
      daily,
      zonedTimeToUtc('2026-03-06', '00:00', NY),
      zonedTimeToUtc('2026-03-11', '00:00', NY),
      NY,
      anchor,
    );

    expect(found.map((o) => o.dateLocal)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    // The clocks changed on the 8th: 07:00 stayed 07:00 locally, and the UTC
    // instant moved by an hour rather than the local time drifting.
    expect(found[1].scheduledStart.toISOString()).toBe('2026-03-07T12:00:00.000Z');
    expect(found[2].scheduledStart.toISOString()).toBe('2026-03-08T11:00:00.000Z');
  });

  it('yields exactly one occurrence per matching day across a fall-back', () => {
    const NY = 'America/New_York';
    const daily: RitualRecurrence = { weekdays: [0, 1, 2, 3, 4, 5, 6], time: '01:30', everyNWeeks: 1 };
    const anchor = zonedTimeToUtc('2026-10-26', '09:00', NY);

    const found = nextOccurrences(
      daily,
      zonedTimeToUtc('2026-10-30', '00:00', NY),
      zonedTimeToUtc('2026-11-03', '00:00', NY),
      NY,
      anchor,
    );

    expect(found.map((o) => o.dateLocal)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    // The doubled 01:30 is materialized once, at the first of the two.
    expect(found[2].scheduledStart.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('crosses the UTC midnight boundary without losing a local day', () => {
    // Every occurrence's UTC date is the day AFTER its local date here.
    const found = nextOccurrences(DINNER, mondayCr, nextMondayCr, CR, mondayCr);

    for (const occurrence of found) {
      expect(occurrence.scheduledStart.toISOString().slice(0, 10)).not.toBe(occurrence.dateLocal);
      expect(localDateOf(occurrence.scheduledStart, CR)).toBe(occurrence.dateLocal);
    }
  });
});
