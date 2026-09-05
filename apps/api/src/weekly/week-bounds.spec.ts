import {
  addDays,
  defaultReviewWeek,
  isMonday,
  localTimeParts,
  localTimeToInstant,
  mondayOf,
  weekBounds,
  weekStartFor,
  weekdayOf,
} from './week-bounds';

// =============================================================================
// Week arithmetic (issue #73)
// =============================================================================
//
// Every case here is one a user actually hits: Sunday night before midnight,
// Monday morning after it, a zone half an hour off the hour, and the two weeks
// a year that are not 168 hours long.
// =============================================================================

describe('weekdayOf / mondayOf / addDays', () => {
  it('reads the weekday of a local calendar date, Sunday = 0', () => {
    expect(weekdayOf('2026-08-30')).toBe(0); // Sunday
    expect(weekdayOf('2026-08-31')).toBe(1); // Monday
    expect(weekdayOf('2026-09-05')).toBe(6); // Saturday
  });

  it('walks back to Monday from any day of the week', () => {
    expect(mondayOf('2026-08-31')).toBe('2026-08-31'); // Monday is its own Monday
    expect(mondayOf('2026-09-06')).toBe('2026-08-31'); // Sunday belongs to the week before
    expect(mondayOf('2026-09-07')).toBe('2026-09-07');
  });

  it('crosses a month and a year boundary', () => {
    expect(addDays('2026-08-31', 7)).toBe('2026-09-07');
    expect(addDays('2027-01-04', -7)).toBe('2026-12-28');
  });

  it('recognises a Monday and nothing else', () => {
    expect(isMonday('2026-08-31')).toBe(true);
    expect(isMonday('2026-09-01')).toBe(false);
    expect(isMonday('2026-8-31')).toBe(false);
  });
});

describe('weekStartFor', () => {
  // 2026-08-31 05:00 UTC is Sunday 23:00 in Costa Rica (UTC-6) and Monday
  // 14:00 in Tokyo (UTC+9). The same instant is in two different weeks.
  const sundayNight = new Date('2026-08-31T05:00:00.000Z');

  it('puts a Sunday 23:00 local instant in the week that is ending', () => {
    expect(weekStartFor(sundayNight, 'America/Costa_Rica')).toBe('2026-08-24');
  });

  it('puts the same instant in the new week for a zone already past midnight', () => {
    expect(weekStartFor(sundayNight, 'Asia/Tokyo')).toBe('2026-08-31');
    expect(weekStartFor(sundayNight, 'UTC')).toBe('2026-08-31');
  });

  it('handles a Monday 00:10 local instant', () => {
    // Monday 00:10 in Costa Rica is Monday 06:10 UTC.
    const mondayMorning = new Date('2026-08-31T06:10:00.000Z');

    expect(weekStartFor(mondayMorning, 'America/Costa_Rica')).toBe('2026-08-31');
  });

  it('handles a half-hour zone', () => {
    // 2026-08-30T18:45Z is Monday 00:15 in Kolkata (UTC+5:30).
    expect(weekStartFor(new Date('2026-08-30T18:45:00.000Z'), 'Asia/Kolkata')).toBe(
      '2026-08-31',
    );
  });
});

describe('weekBounds', () => {
  it('spans exactly seven local days in a stable zone', () => {
    const { start, end } = weekBounds('2026-08-31', 'America/Costa_Rica');

    expect(start.toISOString()).toBe('2026-08-31T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-07T06:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600_000);
  });

  it('is 167 hours across the spring DST change, not 168', () => {
    // Europe/Madrid springs forward on the last Sunday of March 2026 (the 29th).
    const { start, end } = weekBounds('2026-03-23', 'Europe/Madrid');

    expect(end.getTime() - start.getTime()).toBe(167 * 3600_000);
  });

  it('is 169 hours across the autumn change', () => {
    // Madrid falls back on 2026-10-25.
    const { start, end } = weekBounds('2026-10-19', 'Europe/Madrid');

    expect(end.getTime() - start.getTime()).toBe(169 * 3600_000);
  });
});

describe('localTimeParts', () => {
  it('agrees with Intl for the weekday and the hour', () => {
    const at = new Date('2026-09-04T22:30:00.000Z'); // Friday 16:30 in Costa Rica
    const parts = localTimeParts(at, 'America/Costa_Rica');

    expect(parts).toEqual({ weekday: 5, hour: 16, minute: 30 });
  });

  it('reports midnight as hour 0, not 24', () => {
    expect(localTimeParts(new Date('2026-09-05T06:00:00.000Z'), 'America/Costa_Rica')).toEqual(
      { weekday: 6, hour: 0, minute: 0 },
    );
  });

  it('falls back to UTC for an unusable zone rather than throwing', () => {
    expect(localTimeParts(new Date('2026-09-04T22:30:00.000Z'), 'Mars/Olympus').hour).toBe(22);
  });
});

describe('defaultReviewWeek', () => {
  const tz = 'America/Costa_Rica';
  // Local noon on each day of the week beginning Monday 2026-08-31.
  const noonOn = (date: string) => new Date(`${date}T18:00:00.000Z`);

  it('looks back on Monday and Tuesday', () => {
    expect(defaultReviewWeek(noonOn('2026-08-31'), tz)).toBe('2026-08-24');
    expect(defaultReviewWeek(noonOn('2026-09-01'), tz)).toBe('2026-08-24');
  });

  it('reviews the week in progress from Wednesday to Sunday', () => {
    for (const date of ['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']) {
      expect(defaultReviewWeek(noonOn(date), tz)).toBe('2026-08-31');
    }
    // Sunday still belongs to the week that started on the 31st.
    expect(defaultReviewWeek(noonOn('2026-09-06'), tz)).toBe('2026-08-31');
  });
});

describe('localTimeToInstant', () => {
  it('resolves a wall clock in the user’s zone, not the server’s', () => {
    expect(localTimeToInstant('2026-09-07', '07:30', 'America/Costa_Rica').toISOString()).toBe(
      '2026-09-07T13:30:00.000Z',
    );
  });

  it('resolves the same wall clock either side of a DST change', () => {
    // Madrid is UTC+1 before 2026-03-29 and UTC+2 after.
    expect(localTimeToInstant('2026-03-27', '09:00', 'Europe/Madrid').toISOString()).toBe(
      '2026-03-27T08:00:00.000Z',
    );
    expect(localTimeToInstant('2026-03-30', '09:00', 'Europe/Madrid').toISOString()).toBe(
      '2026-03-30T07:00:00.000Z',
    );
  });

  it('gets the hour right on the transition day itself', () => {
    // 09:00 on the morning the clocks went forward is already in summer time.
    // `localDayBounds(date).start + 9h` would answer 08:00Z here, an hour out.
    expect(localTimeToInstant('2026-03-29', '09:00', 'Europe/Madrid').toISOString()).toBe(
      '2026-03-29T07:00:00.000Z',
    );
  });
});
