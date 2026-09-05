// =============================================================================
// What "today" means for one user (issue #38, epic E05)
// =============================================================================
//
// NO DATE LIBRARY. `Intl.DateTimeFormat` with a `timeZone` is in the platform,
// knows the IANA database the runtime ships, and handles the two cases a
// hand-rolled offset gets wrong: half-hour zones and the days DST changes.
//
// Everything about a day boundary in this product resolves through here.
// Getting it wrong is not cosmetic: a commitment scheduled for tonight would
// disappear from Today at 18:00 for a user in UTC-6, and the check-in they made
// this evening would be filed under tomorrow.
// =============================================================================

/** What an unset, unknown or unparseable timezone falls back to. */
export const FALLBACK_TIME_ZONE = 'UTC';

/**
 * Whether the runtime can resolve this zone.
 *
 * A stored timezone is user input that survived a migration and a client
 * library; a bad one must degrade to UTC rather than 500 the whole Today screen.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The given zone, or UTC when it is missing or unusable. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;

  return isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE;
}

/**
 * The local calendar date as `YYYY-MM-DD`.
 *
 * `en-CA` because its short date format IS `YYYY-MM-DD` — using it avoids
 * reassembling parts by hand, which is where zero-padding bugs live.
 */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The local wall-clock hour, 0–23. */
export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimeZone(timeZone),
    hour: '2-digit',
    hour12: false,
  }).format(now);

  // `en-GB` renders midnight as "24" in some ICU versions.
  return Number(hour) % 24;
}

/**
 * The UTC instants bounding a local calendar day: `[start, end)`.
 *
 * Derived by measuring the zone's offset AT that date rather than assuming a
 * fixed one, so the 23-hour and 25-hour days DST produces come out right. The
 * offset is sampled twice — once at a provisional midnight, once at the
 * corrected one — because a DST transition inside the day would otherwise leave
 * the boundary an hour off.
 */
export function localDayBounds(
  dateLocal: string,
  timeZone: string,
): { start: Date; end: Date } {
  const zone = safeTimeZone(timeZone);
  const [year, month, day] = dateLocal.split('-').map(Number);

  const start = resolveLocalMidnight(year, month, day, zone);
  // The next local day's midnight, which is this day's exclusive end.
  const nextUtc = new Date(Date.UTC(year, month - 1, day) + 24 * 3600_000);
  const end = resolveLocalMidnight(
    nextUtc.getUTCFullYear(),
    nextUtc.getUTCMonth() + 1,
    nextUtc.getUTCDate(),
    zone,
  );

  return { start, end };
}

/** The UTC instant of local midnight on this calendar date. */
function resolveLocalMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = naive - offsetMillis(new Date(naive), timeZone);

  // Second pass: the offset at the provisional instant may differ from the one
  // at naive-UTC across a DST boundary.
  instant = naive - offsetMillis(new Date(instant), timeZone);

  return new Date(instant);
}

/** How far ahead of UTC this zone is, in milliseconds, at this instant. */
function offsetMillis(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return asUtc - at.getTime();
}

export type Greeting = 'morning' | 'afternoon' | 'evening';

/**
 * 05–11 morning, 12–17 afternoon, otherwise evening.
 *
 * Late night is "evening" rather than a fourth band: a user awake at 02:00 is
 * finishing a day, not starting one, and "Good night" reads as a farewell on a
 * screen whose whole purpose is to offer them something to do.
 */
export function greetingFor(now: Date, timeZone: string): Greeting {
  const hour = localHour(now, timeZone);

  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';

  return 'evening';
}

/**
 * The user's local week, Monday-start (issue #49, epic E12).
 *
 * MONDAY, NOT SUNDAY, and not configurable. E08 already fixed Monday-start for
 * the family summary and `docs/specs/family-domain.md` records why; a second
 * week convention in the same product would mean "this week" answers two
 * different questions on two screens. The weekly cap is compared against what
 * the user sees on the review screen, so it has to agree with it.
 *
 * Built on `localDayBounds`, so it inherits its DST handling for free: the
 * bounds are real instants derived from local midnights, which is why a week
 * containing a DST switch is 167 or 169 hours long rather than a fixed 7 * 24.
 */
export function localWeekBounds(
  dateLocal: string,
  timeZone: string,
): { start: Date; end: Date } {
  const [year, month, day] = dateLocal.split('-').map(Number);
  // getUTCDay on a UTC-midnight date gives the weekday of the LOCAL calendar
  // date, because `dateLocal` is already a local calendar date with no instant.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // Sunday is 0 in JS; a Monday-start week puts it six days after the start.
  const daysSinceMonday = (weekday + 6) % 7;

  const mondayUtc = new Date(
    Date.UTC(year, month - 1, day) - daysSinceMonday * 24 * 3600_000,
  );
  const sundayUtc = new Date(mondayUtc.getTime() + 6 * 24 * 3600_000);

  const { start } = localDayBounds(toDateLocal(mondayUtc), timeZone);
  const { end } = localDayBounds(toDateLocal(sundayUtc), timeZone);
  return { start, end };
}

function toDateLocal(utcMidnight: Date): string {
  return utcMidnight.toISOString().slice(0, 10);
}
