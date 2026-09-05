import {
  localDate,
  localDayBounds,
  safeTimeZone,
  zoneOffsetMillis,
} from '../today/local-date';

// =============================================================================
// What "this week" means for one user (issue #73, epic E10)
// =============================================================================
//
// NO DATE LIBRARY, for the reasons `today/local-date.ts` sets out at length.
// Everything here is built on `localDate` and `localDayBounds`, so it inherits
// their DST handling: a week containing a switch is 167 or 169 hours, never
// 7 × 24.
//
// WEEKS ARE MONDAY-START AND ARE ADDRESSED BY THEIR LOCAL MONDAY as a
// 'YYYY-MM-DD' string. E08's family summary and E12's weekly cap already fixed
// Monday-start and `docs/specs/family-domain.md` records why; a second week
// convention in the same product would make "this week" two questions with two
// answers on two screens.
// =============================================================================

/** Milliseconds in a calendar day, used only for date arithmetic on UTC midnights. */
const DAY_MS = 24 * 3600_000;

/**
 * The weekday of a local calendar date, 0 = Sunday.
 *
 * `getUTCDay` on a UTC midnight built from the date parts, because
 * `dateLocal` is a calendar date with no instant — reading it in any zone
 * would be reading a timestamp it does not have.
 */
export function weekdayOf(dateLocal: string): number {
  const [year, month, day] = dateLocal.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** `dateLocal` shifted by `n` calendar days, still as 'YYYY-MM-DD'. */
export function addDays(dateLocal: string, n: number): string {
  const [year, month, day] = dateLocal.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The Monday of the week containing this local calendar date. */
export function mondayOf(dateLocal: string): string {
  // Sunday is 0 in JS; a Monday-start week puts it six days after the start.
  return addDays(dateLocal, -((weekdayOf(dateLocal) + 6) % 7));
}

/** The local Monday of the week `now` falls in, as 'YYYY-MM-DD'. */
export function weekStartFor(now: Date, timeZone: string): string {
  return mondayOf(localDate(now, timeZone));
}

/** Whether a string is a local Monday in `'YYYY-MM-DD'` form. */
export function isMonday(dateLocal: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateLocal) && weekdayOf(dateLocal) === 1;
}

/**
 * The UTC instants bounding a local week: `[start, end)`.
 *
 * `end` is the NEXT Monday's local midnight, derived from `localDayBounds`
 * rather than `start + 7 days`. Adding milliseconds would be an hour wrong for
 * every week containing a DST switch, and the rows an hour either side of that
 * boundary are exactly the early-morning and late-evening commitments the
 * time-window aggregation is about.
 */
export function weekBounds(
  weekStart: string,
  timeZone: string,
): { start: Date; end: Date } {
  const zone = safeTimeZone(timeZone);

  return {
    start: localDayBounds(weekStart, zone).start,
    end: localDayBounds(addDays(weekStart, 7), zone).start,
  };
}

export interface LocalTimeParts {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  hour: number;
  minute: number;
}

/**
 * The user's local weekday and wall-clock time right now.
 *
 * Read from one `formatToParts` call rather than three formatters, so the three
 * values cannot straddle a minute boundary and disagree with each other.
 */
export function localTimeParts(now: Date, timeZone: string): LocalTimeParts {
  const zone = safeTimeZone(timeZone);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    weekday: weekdayOf(localDate(now, zone)),
    // `en-CA` renders midnight as "24" in some ICU versions, as en-GB does.
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

/**
 * Which week a review with no explicit `weekStart` is about.
 *
 * MONDAY AND TUESDAY LOOK BACK; WEDNESDAY TO SUNDAY REVIEW THE WEEK IN
 * PROGRESS. A Monday-morning review of "this week" would be a review of nothing
 * — no commitment has happened yet — and a Friday review of "last week" would
 * ignore the four days the user is actually asking about. The split is at
 * Wednesday because that is the first day on which the week in progress has
 * more information in it than the week before has relevance.
 */
export function defaultReviewWeek(now: Date, timeZone: string): string {
  const today = localDate(now, safeTimeZone(timeZone));
  const thisMonday = mondayOf(today);
  const weekday = weekdayOf(today);

  // 1 = Monday, 2 = Tuesday.
  return weekday === 1 || weekday === 2 ? addDays(thisMonday, -7) : thisMonday;
}

/**
 * The UTC instant of a local wall-clock time on a local date.
 *
 * NEVER `new Date('YYYY-MM-DDTHH:mm')` — that string is parsed in the SERVER's
 * zone, which is how a materialised 07:30 commitment ends up at 01:30 for the
 * user. And never `localDayBounds(date).start + minutes` either: on the two
 * days a year the offset moves, midnight's offset is not this hour's, and the
 * commitment lands an hour out.
 *
 * The same two-pass measurement `resolveLocalMidnight` uses, for the same
 * reason — the offset at naive-UTC may not be the offset at the instant that
 * naive-UTC resolves to.
 */
export function localTimeToInstant(
  dateLocal: string,
  time: string,
  timeZone: string,
): Date {
  const zone = safeTimeZone(timeZone);
  const [year, month, day] = dateLocal.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  const naive = Date.UTC(year, month - 1, day, hours, minutes, 0);
  let instant = naive - zoneOffsetMillis(new Date(naive), zone);
  instant = naive - zoneOffsetMillis(new Date(instant), zone);

  return new Date(instant);
}
