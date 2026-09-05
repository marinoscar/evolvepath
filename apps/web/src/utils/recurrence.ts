import type { RitualRecurrence } from '../types';

// ===========================================================================
// Describing a recurrence (epic E08, issue #50)
// ===========================================================================
//
// WEEKDAY VALUES ARE `0 = Sunday`, matching `Date#getDay()` and the API. Only
// the DISPLAY order is Monday-first, and it is Monday-first because a week that
// starts on Sunday puts the weekend at both ends — which is exactly the layout
// a user scanning "Tue, Thu, Sun" has to un-read.
//
// Keeping the two apart in one file, rather than converting at the edges, is
// deliberate: a conversion that happens in three components is a conversion
// that will be forgotten in a fourth.
// ===========================================================================

/** Display order. The VALUES stay `0 = Sunday`; only this array is reordered. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEKDAY_SHORT: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

/** Full names, for the `aria-label` of a weekday toggle. */
export const WEEKDAY_LONG: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const CADENCE_PREFIX: Record<number, string> = {
  1: '',
  2: 'Every 2 weeks on ',
  4: 'Every 4 weeks on ',
};

/**
 * "Tue, Thu, Sun · 18:30", "Every 2 weeks on Sat · 10:00", "Daily · 20:00".
 *
 * All seven days reads "Daily" rather than "Mon, Tue, Wed, Thu, Fri, Sat, Sun":
 * the list is technically right and nobody parses it.
 */
export function describeRecurrence(recurrence: RitualRecurrence): string {
  const days = WEEKDAY_ORDER.filter((day) => recurrence.weekdays.includes(day));

  const label =
    days.length === 7
      ? 'Daily'
      : `${CADENCE_PREFIX[recurrence.everyNWeeks] ?? ''}${days
          .map((day) => WEEKDAY_SHORT[day])
          .join(', ')}`;

  // A recurrence with no days is not creatable — the form and the API both
  // refuse it — but a ritual rendered mid-edit can transiently have none.
  return days.length === 0 ? recurrence.time : `${label} · ${recurrence.time}`;
}

/** "45 min (min 10)" — the two durations as one line. */
export function describeDurations(idealMinutes: number, minimumMinutes: number): string {
  return `${idealMinutes} min (min ${minimumMinutes})`;
}
