/**
 * The time-of-day greeting on Today.
 *
 * A pure function of the LOCAL hour, and separate from the page so the
 * boundaries can be tested without freezing a clock. The boundaries are the
 * conventional ones — morning from 05:00, afternoon from 12:00, evening from
 * 18:00 — and the small hours read as "evening" rather than "night" because
 * someone opening this app at 02:00 has not started a new day yet.
 */
export function greetingFor(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}
