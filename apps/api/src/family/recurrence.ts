import { safeTimeZone } from '../today/local-date';
import type { RitualRecurrence } from './family.schema';

// =============================================================================
// The recurrence engine (issue #41, epic E08)
// =============================================================================
//
// PURE. No Prisma, no DI, no `Date.now()` — every function here takes the
// instants it needs. That is what makes DST behaviour testable at all: the
// interesting cases are two specific afternoons a year in each zone, and a
// function that reads the clock cannot be asked about them.
//
// NO DATE LIBRARY, for the reason `today/local-date.ts` gives: `Intl` knows the
// IANA database the runtime ships, including the half-hour zones and the days
// that are 23 or 25 hours long. What is added here and not there is resolving a
// WALL TIME — "18:30 local" — into an instant, which has two answers on two
// days a year and needs a stated rule for each.
//
// -----------------------------------------------------------------------------
// THE TWO AMBIGUOUS DAYS, AND WHAT THIS FILE DOES ON THEM
// -----------------------------------------------------------------------------
//
// SPRING FORWARD (a gap). 02:30 on 8 March 2026 does not exist in New York:
// the clocks go 01:59 → 03:00. The ritual still has to happen, so the wall time
// is SHIFTED FORWARD BY THE LENGTH OF THE GAP — 02:30 becomes 03:30 EDT, which
// is `2026-03-08T07:30:00Z`. Shifting forward rather than back is the choice
// that keeps a 07:00 workout in the morning instead of moving it to 06:00.
//
// FALL BACK (an overlap). 01:30 on 1 November 2026 happens twice in New York.
// The FIRST (still-DST) instant wins — `2026-11-01T05:30:00Z`. Picking the
// first means the reminder fires at the first 01:30 the user experiences; the
// alternative would put it an hour after they expected it, in a zone where
// clocks read the same either way.
//
// These are the two rules `Temporal`'s `'compatible'` disambiguation uses, and
// deliberately so: when that API is available everywhere this file can be
// deleted rather than reinterpreted.
//
// -----------------------------------------------------------------------------
// WEEKS START ON MONDAY, AND CADENCE IS ANCHORED TO THE RITUAL'S CREATION WEEK
// -----------------------------------------------------------------------------
//
// `everyNWeeks` needs an origin, and the only one that survives editing is the
// ritual's own `createdAt`: ISO week numbers wrap at the year boundary (week 52
// is followed by week 1, three weeks after week 49 by that arithmetic), and
// "weeks since the epoch" would make "every 2 weeks" mean a different fortnight
// for two users who created the same ritual on the same day. Counting whole
// Monday-start weeks between two dates has neither problem.
// =============================================================================

/** One materializable date, in UTC and in the user's own calendar. */
export interface Occurrence {
  scheduledStart: Date;
  /** `YYYY-MM-DD` in `timezone` — the local day the occurrence belongs to. */
  dateLocal: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

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
    hourCycle: 'h23',
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return asUtc - at.getTime();
}

/**
 * The instant at which the clock in `timezone` reads `dateLocal` `time`.
 *
 * The algorithm is the standard two-candidate resolution, and each step is
 * load-bearing:
 *
 *   1. Sample the zone's offset a day either side of the naive instant. A
 *      transition can only fall between them, and no real offset is anywhere
 *      near 24 hours, so both candidates are inside the sampled window.
 *   2. Build a candidate from each offset and ask the zone what each one
 *      actually reads. A candidate whose offset ROUND-TRIPS is a real instant
 *      with that wall time.
 *   3. Both round-trip → the wall time happens twice (an overlap): take the
 *      earlier. Exactly one → unambiguous. Neither → the wall time never
 *      happens (a gap): return the candidate built from the offset BEFORE the
 *      transition, which is the wall time pushed forward by the gap.
 *
 * A single-pass "guess the offset and subtract it" is wrong for every wall time
 * within one offset's distance after a spring-forward transition, which is a
 * whole evening's worth of rituals in the Americas.
 */
export function zonedTimeToUtc(dateLocal: string, time: string, timezone: string): Date {
  const zone = safeTimeZone(timezone);
  const [year, month, day] = dateLocal.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const offsetBefore = offsetMillis(new Date(naive - DAY_MS), zone);
  const offsetAfter = offsetMillis(new Date(naive + DAY_MS), zone);

  const candidateBefore = naive - offsetBefore;
  const candidateAfter = naive - offsetAfter;

  const beforeIsReal = offsetMillis(new Date(candidateBefore), zone) === offsetBefore;
  const afterIsReal = offsetMillis(new Date(candidateAfter), zone) === offsetAfter;

  if (beforeIsReal && afterIsReal) {
    // The overlap. The earlier instant is the first time the clock reads this.
    return new Date(Math.min(candidateBefore, candidateAfter));
  }

  if (afterIsReal) return new Date(candidateAfter);

  // Unambiguous (both offsets equal, so both candidates are the same instant),
  // or the gap — in which case this is the wall time shifted forward.
  return new Date(candidateBefore);
}

/** The local calendar date of an instant, as `YYYY-MM-DD`. */
export function localDateOf(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** `0 = Sunday … 6 = Saturday` for a `YYYY-MM-DD` string. */
export function weekdayOf(dateLocal: string): number {
  const [year, month, day] = dateLocal.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Add whole days to a `YYYY-MM-DD` string, staying in the calendar. */
export function addDays(dateLocal: string, days: number): string {
  const [year, month, day] = dateLocal.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);

  return shifted.toISOString().slice(0, 10);
}

/** The Monday of the week containing this calendar date. */
export function weekStartOfDate(dateLocal: string): string {
  // 0 = Sunday, so Sunday is 6 days into a Monday-start week, not 0.
  const daysSinceMonday = (weekdayOf(dateLocal) + 6) % 7;

  return addDays(dateLocal, -daysSinceMonday);
}

/**
 * The Monday of the week this instant falls in, IN THE USER'S ZONE.
 *
 * The zone is the whole point: 23:30 UTC on a Sunday is still Sunday in Costa
 * Rica and belongs to the week that is ending, while the same instant is Monday
 * in Auckland and belongs to the one starting.
 */
export function weekStartLocal(instant: Date, timezone: string): string {
  return weekStartOfDate(localDateOf(instant, timezone));
}

/** Whole weeks from `weekStartA` to `weekStartB`; negative when B is earlier. */
export function weeksBetween(weekStartA: string, weekStartB: string): number {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return Math.round((toUtc(weekStartB) - toUtc(weekStartA)) / WEEK_MS);
}

/**
 * Every occurrence of `recurrence` in `(from, to]`, ascending.
 *
 * `from` is EXCLUSIVE and `to` INCLUSIVE so that repeated calls with the
 * previous horizon as the new `from` neither skip nor repeat a boundary
 * occurrence. The materializer relies on that; the unique index catches it if
 * this is ever wrong, but a duplicate that is merely swallowed is still a bug.
 */
export function nextOccurrences(
  recurrence: RitualRecurrence,
  from: Date,
  to: Date,
  timezone: string,
  anchor: Date,
): Occurrence[] {
  if (to.getTime() <= from.getTime()) return [];

  const zone = safeTimeZone(timezone);
  const weekdays = new Set(recurrence.weekdays);
  const anchorWeek = weekStartLocal(anchor, zone);

  const occurrences: Occurrence[] = [];

  // Walk local CALENDAR days, not 24-hour steps: the day a zone loses an hour
  // is 23 hours long, and stepping by milliseconds would skip or repeat it.
  // One day of slack either side covers a window whose ends fall on a different
  // local date than their UTC date.
  let dateLocal = addDays(localDateOf(from, zone), -1);
  const lastDate = addDays(localDateOf(to, zone), 1);

  while (dateLocal <= lastDate) {
    if (weekdays.has(weekdayOf(dateLocal))) {
      const weeks = weeksBetween(anchorWeek, weekStartOfDate(dateLocal));

      if (weeks % recurrence.everyNWeeks === 0) {
        const scheduledStart = zonedTimeToUtc(dateLocal, recurrence.time, zone);

        if (scheduledStart.getTime() > from.getTime() && scheduledStart.getTime() <= to.getTime()) {
          occurrences.push({ scheduledStart, dateLocal });
        }
      }
    }

    dateLocal = addDays(dateLocal, 1);
  }

  return occurrences.sort(
    (a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime(),
  );
}
