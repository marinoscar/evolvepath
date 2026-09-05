import { describe, it, expect } from 'vitest';

import {
  WEEKDAY_ORDER,
  describeDurations,
  describeRecurrence,
} from '../../utils/recurrence';

describe('describeRecurrence', () => {
  it('renders weekdays Monday-first while the values stay 0 = Sunday', () => {
    // `[0, 2, 4]` is Sunday, Tuesday, Thursday — and reads Tue, Thu, Sun.
    expect(describeRecurrence({ weekdays: [0, 2, 4], time: '18:30', everyNWeeks: 1 })).toBe(
      'Tue, Thu, Sun · 18:30',
    );
  });

  it('is unaffected by the order the days arrive in', () => {
    expect(describeRecurrence({ weekdays: [4, 0, 2], time: '18:30', everyNWeeks: 1 })).toBe(
      'Tue, Thu, Sun · 18:30',
    );
  });

  it('names the cadence when it is not weekly', () => {
    expect(describeRecurrence({ weekdays: [6], time: '10:00', everyNWeeks: 2 })).toBe(
      'Every 2 weeks on Sat · 10:00',
    );
    expect(describeRecurrence({ weekdays: [6], time: '10:00', everyNWeeks: 4 })).toBe(
      'Every 4 weeks on Sat · 10:00',
    );
  });

  // The seven-day list is technically right and nobody parses it.
  it('says Daily for all seven days', () => {
    expect(
      describeRecurrence({ weekdays: [0, 1, 2, 3, 4, 5, 6], time: '20:00', everyNWeeks: 1 }),
    ).toBe('Daily · 20:00');
  });

  it('survives a recurrence mid-edit with no days selected', () => {
    expect(describeRecurrence({ weekdays: [], time: '18:30', everyNWeeks: 1 })).toBe('18:30');
  });
});

describe('WEEKDAY_ORDER', () => {
  it('starts on Monday and ends on Sunday, with Sunday still 0', () => {
    expect([...WEEKDAY_ORDER]).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('describeDurations', () => {
  it('reads as one line', () => {
    expect(describeDurations(45, 10)).toBe('45 min (min 10)');
  });
});
