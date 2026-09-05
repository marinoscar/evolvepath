import { describe, it, expect } from 'vitest';

import { greetingFor } from '../../utils/greeting';

/**
 * The boundaries, not a sample. A greeting that says "afternoon" at 11:59 is
 * the kind of thing nobody notices in review and everybody notices at 11:59.
 */
describe('greetingFor', () => {
  it.each([
    [5, 'morning'],
    [8, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [15, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [22, 'evening'],
  ])('%d:00 → %s', (hour, expected) => {
    expect(greetingFor(hour)).toBe(expected);
  });

  // The small hours read as "evening" rather than "night": someone opening
  // this app at 02:00 has not started a new day yet.
  it.each([[0], [3], [4]])('reads %d:00 as evening, not the start of a new day', (hour) => {
    expect(greetingFor(hour)).toBe('evening');
  });

  it('covers every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(['morning', 'afternoon', 'evening']).toContain(greetingFor(hour));
    }
  });
});
