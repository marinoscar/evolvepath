import {
  addDays,
  daysBetween,
  MIN_POINTS_FOR_TREND,
  rollingMean,
  summarise,
} from './rolling-mean';

// =============================================================================
// PRD §47's arithmetic (issue #113, epic E09)
//
// The interesting cases are the ones where a naive implementation is quietly
// wrong: month boundaries, unlogged days inside the window, and the single
// reading that must NOT produce a line the user would read as a direction.
// =============================================================================

const point = (dateLocal: string, weightKg: number) => ({ dateLocal, weightKg });

describe('addDays / daysBetween', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('measures the distance between two dates', () => {
    expect(daysBetween('2026-08-31', '2026-09-07')).toBe(7);
    expect(daysBetween('2026-09-07', '2026-08-31')).toBe(-7);
  });
});

describe('rollingMean', () => {
  it('reports one value per calendar day, logged or not', () => {
    const trend = rollingMean(
      [point('2026-09-01', 82), point('2026-09-02', 82.4)],
      '2026-09-01',
      '2026-09-05',
    );

    // A chart that skipped unlogged days would compress a fortnight of silence
    // into the same width as a fortnight of readings and lie about the slope.
    expect(trend.map((t) => t.dateLocal)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('says nothing on a day with only one reading behind it', () => {
    const trend = rollingMean([point('2026-09-01', 82)], '2026-09-01', '2026-09-02');

    expect(trend.every((t) => t.rolling7Kg === null)).toBe(true);
  });

  it('averages the readings inside the seven-day window', () => {
    const trend = rollingMean(
      [point('2026-09-01', 82), point('2026-09-02', 83)],
      '2026-09-02',
      '2026-09-02',
    );

    expect(trend[0].rolling7Kg).toBe(82.5);
  });

  it('forgets a reading once it falls out of the window', () => {
    const trend = rollingMean(
      [point('2026-09-01', 90), point('2026-09-08', 80), point('2026-09-09', 80)],
      '2026-09-09',
      '2026-09-09',
    );

    // 2026-09-01 is eight days back, so it is gone; 80 and 80 remain.
    expect(trend[0].rolling7Kg).toBe(80);
  });

  it('does not care what order the readings arrive in', () => {
    const sorted = rollingMean(
      [point('2026-09-01', 82), point('2026-09-02', 83)],
      '2026-09-02',
      '2026-09-02',
    );
    const shuffled = rollingMean(
      [point('2026-09-02', 83), point('2026-09-01', 82)],
      '2026-09-02',
      '2026-09-02',
    );

    expect(shuffled).toEqual(sorted);
  });

  it('works across a month boundary', () => {
    const trend = rollingMean(
      [point('2026-08-30', 82), point('2026-09-01', 81)],
      '2026-09-01',
      '2026-09-01',
    );

    expect(trend[0].rolling7Kg).toBe(81.5);
  });

  it('returns nothing for a backwards window', () => {
    expect(rollingMean([], '2026-09-05', '2026-09-01')).toEqual([]);
  });

  it('needs two readings before it will draw anything at all', () => {
    expect(MIN_POINTS_FOR_TREND).toBe(2);
  });
});

describe('summarise', () => {
  it('reports the change between the first and last trend values', () => {
    const trend = rollingMean(
      [
        point('2026-09-01', 83),
        point('2026-09-02', 83),
        point('2026-09-08', 82.4),
        point('2026-09-09', 82.4),
      ],
      '2026-09-02',
      '2026-09-09',
    );

    expect(summarise(trend, 4)).toMatchObject({ first: 83, last: 82.4, deltaKg: -0.6, days: 4 });
  });

  it('says nothing when there is not enough to say', () => {
    expect(summarise(rollingMean([point('2026-09-01', 82)], '2026-09-01', '2026-09-05'), 1)).toBeNull();
  });

  it('carries no judgment — only a number and a count', () => {
    const trend = rollingMean(
      [point('2026-09-01', 83), point('2026-09-02', 84)],
      '2026-09-02',
      '2026-09-03',
    );

    expect(Object.keys(summarise(trend, 2)!).sort()).toEqual([
      'days',
      'deltaKg',
      'first',
      'last',
    ]);
  });
});
