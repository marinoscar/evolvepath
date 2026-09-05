// =============================================================================
// Quiet hours (issue #59, epic E12)
// =============================================================================
//
// PRD §59's most visible input and the one a user notices immediately when it
// is wrong. Two properties make it worth its own file:
//
//   1. IT IS EVALUATED IN THE USER'S ZONE, never the server's. A window stored
//      as "22:00–07:00" is a claim about a wall clock, and the server's wall
//      clock is not the one the user is asleep under.
//   2. IT USUALLY CROSSES MIDNIGHT. `start <= t < end` is the obvious
//      implementation and it is wrong for exactly the case everybody
//      configures: with `22:00–07:00` it matches nothing at all, so quiet hours
//      silently do not work and every test written against a 12:00–13:00 window
//      passes.

import { safeTimeZone } from '../../today/local-date';
import type { QuietHours } from './notification-policy.schema';

/** The user's wall clock as `HH:mm`, 00:00–23:59. */
export function localTimeOfDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    // `hourCycle: 'h23'` matters: without it midnight formats as `24:00` in
    // some locales/zones, which sorts after every other time and puts the user
    // outside a window that should contain them.
    hourCycle: 'h23',
  }).format(now);
}

/**
 * Is `now` inside the user's quiet window?
 *
 * The window is half-open, `[start, end)`: a window ending at 07:00 stops
 * suppressing AT 07:00, so a 07:00 commitment reminder goes out. Closing it
 * would make the boundary minute belong to both the quiet night and the
 * waking day, and the user would notice only on the one morning it mattered.
 */
export function isQuietNow(
  now: Date,
  timeZone: string,
  quietHours: QuietHours | null,
): boolean {
  if (!quietHours) return false;

  const t = localTimeOfDay(now, timeZone);
  const { start, end } = quietHours;

  // The ordinary case: a window inside one calendar day, e.g. 12:00-13:00.
  if (start < end) return t >= start && t < end;

  // The case everybody actually configures: the window crosses midnight, so
  // "inside" is the UNION of the two pieces it is cut into, not the gap
  // between them.
  return t >= start || t < end;
}
