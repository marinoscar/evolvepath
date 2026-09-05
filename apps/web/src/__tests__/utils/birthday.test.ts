import { describe, it, expect } from 'vitest';

import {
  daysUntilBirthday,
  describeBirthdayCue,
  formatBirthdayWithoutYear,
} from '../../utils/birthday';

describe('daysUntilBirthday', () => {
  it('counts the days to the next occurrence', () => {
    expect(daysUntilBirthday('2018-05-14', '2026-05-09')).toBe(5);
  });

  it('is 0 on the day itself', () => {
    expect(daysUntilBirthday('2018-05-09', '2026-05-09')).toBe(0);
  });

  it('rolls to next year the day after', () => {
    // 2027 is not a leap year, so the 8th of May is 364 days away.
    expect(daysUntilBirthday('2018-05-08', '2026-05-09')).toBe(364);
  });

  // The year may be the 1900 placeholder the editor sends; nothing reads it.
  it('ignores the year entirely', () => {
    expect(daysUntilBirthday('1900-05-14', '2026-05-09')).toBe(
      daysUntilBirthday('2018-05-14', '2026-05-09'),
    );
  });

  it('observes 29 February on the 28th in a non-leap year', () => {
    // 2027 is not a leap year: the cue lands on 28 February, in the same month.
    expect(daysUntilBirthday('2000-02-29', '2027-02-27')).toBe(1);
    // 2028 is, so the real date is used.
    expect(daysUntilBirthday('2000-02-29', '2028-02-27')).toBe(2);
  });

  it('crosses a year boundary', () => {
    expect(daysUntilBirthday('2018-01-02', '2026-12-31')).toBe(2);
  });

  it('returns null for no birthday', () => {
    expect(daysUntilBirthday(null, '2026-05-09')).toBeNull();
    expect(daysUntilBirthday(undefined, '2026-05-09')).toBeNull();
  });

  it('returns null for something that is not a date', () => {
    expect(daysUntilBirthday('not-a-date', '2026-05-09')).toBeNull();
  });
});

describe('describeBirthdayCue', () => {
  it.each([
    [0, 'Birthday today'],
    [1, 'Birthday tomorrow'],
    [5, 'Birthday in 5 days'],
    [7, 'Birthday in 7 days'],
  ])('describes %s days as %s', (days, expected) => {
    expect(describeBirthdayCue(days)).toBe(expected);
  });

  it('says nothing beyond the window', () => {
    expect(describeBirthdayCue(8)).toBeNull();
    expect(describeBirthdayCue(null)).toBeNull();
  });
});

describe('formatBirthdayWithoutYear', () => {
  it('never prints the year', () => {
    const formatted = formatBirthdayWithoutYear('1900-05-09');

    expect(formatted).not.toContain('1900');
    expect(formatted).toContain('9');
  });

  it('formats 29 February rather than rolling it forward', () => {
    expect(formatBirthdayWithoutYear('1900-02-29')).toContain('29');
  });

  it('returns null for no birthday', () => {
    expect(formatBirthdayWithoutYear(null)).toBeNull();
  });
});
