import { localDate, localWeekBounds } from '../../today/local-date';
import type { WindowCommitment } from './momentum-engine';

// =============================================================================
// The consistency run (issue #98, epic E11)
// =============================================================================
//
// PRD §55 asks for a run counted in WEEKS with grace, not a daily streak.
// VISION §31: "one missed day should not erase weeks of effort" — a daily
// streak does exactly that, and the product that shows it teaches people that
// the honest thing to do after a bad Tuesday is to stop looking.
//
// Pure: the caller passes the rows, `now` and the timezone. Weeks are Monday-
// start in the user's own zone, which is the convention E08 fixed for the
// family summary and E10 reuses for the weekly review; a second week
// convention would make "this week" answer two questions on two screens.
// =============================================================================

/** How much of a week has to land for it to count. */
export const WEEK_SUCCESS_RATIO = 0.6;
/** One forgiven week per this many counted weeks. */
export const GRACE_EVERY_N_WEEKS = 4;
/** How far back the walk looks before giving up. */
export const RUN_LOOKBACK_WEEKS = 26;
/** How many weeks the Progress bars render. */
export const WEEKLY_CHART_WEEKS = 12;

const DAY_MS = 24 * 3_600_000;

export interface WeekStat {
  /** `YYYY-MM-DD`, the Monday, in the user's timezone. */
  weekStart: string;
  planned: number;
  completed: number;
  success: boolean;
  graced: boolean;
  /** The week in progress. Reported, never counted. */
  current: boolean;
}

export interface ConsistencyRun {
  weeks: number;
  graceUsed: number;
  /** The last 12 weeks, ascending. */
  weekly: WeekStat[];
}

const SUCCESS = ['COMPLETED', 'PARTIALLY_COMPLETED'];
const FAILURE = ['MISSED', 'SKIPPED'];
const OPEN = ['PLANNED', 'READY'];

function decided(row: WindowCommitment, now: Date): boolean {
  if (SUCCESS.includes(row.status) || FAILURE.includes(row.status)) return true;
  return OPEN.includes(row.status) && row.scheduledStart < now;
}

/**
 * Week buckets, oldest first, ending with the week `now` falls in.
 *
 * Built by walking back in 7-day steps from today's local Monday and asking
 * `localWeekBounds` for each — rather than by adding 7 * 24h to an instant,
 * which drifts by an hour across every DST change and eventually files a
 * Monday morning under the previous week.
 */
function weekBuckets(now: Date, timeZone: string, count: number) {
  const buckets: Array<{ weekStart: string; start: Date; end: Date }> = [];

  for (let i = count - 1; i >= 0; i -= 1) {
    const at = new Date(now.getTime() - i * 7 * DAY_MS);
    const { start, end } = localWeekBounds(localDate(at, timeZone), timeZone);
    buckets.push({ weekStart: localDate(start, timeZone), start, end });
  }

  // A DST-shortened step can land twice in the same week; keep one of each.
  return buckets.filter(
    (bucket, index) => buckets.findIndex((b) => b.weekStart === bucket.weekStart) === index,
  );
}

export function computeConsistencyRun(
  commitments: WindowCommitment[],
  now: Date,
  timeZone: string,
): ConsistencyRun {
  const buckets = weekBuckets(now, timeZone, RUN_LOOKBACK_WEEKS);
  const rows = commitments.filter((row) => decided(row, now));

  const stats: WeekStat[] = buckets.map((bucket) => {
    const inWeek = rows.filter(
      (row) => row.scheduledStart >= bucket.start && row.scheduledStart < bucket.end,
    );
    const completed = inWeek.filter((row) => SUCCESS.includes(row.status)).length;
    const planned = inWeek.length;

    return {
      weekStart: bucket.weekStart,
      planned,
      completed,
      success: planned >= 1 && completed / planned >= WEEK_SUCCESS_RATIO,
      graced: false,
      current: now >= bucket.start && now < bucket.end,
    };
  });

  const { weeks, graceUsed } = walk(stats);

  return {
    weeks,
    graceUsed,
    weekly: stats.slice(-WEEKLY_CHART_WEEKS),
  };
}

/**
 * Walk completed weeks newest-first.
 *
 * An empty week is NEUTRAL — skipped entirely rather than counted as a failure.
 * A week in which the user planned nothing is a week they made no promise, and
 * breaking a run on it would punish the one honest thing a busy person can do.
 */
function walk(stats: WeekStat[]): { weeks: number; graceUsed: number } {
  const completedWeeks = stats.filter((week) => !week.current).reverse();

  let weeks = 0;
  let graceUsed = 0;
  let counted = 0;
  // Counted weeks since the most recent grace; a fresh run starts forgiven.
  let sinceGrace = GRACE_EVERY_N_WEEKS;

  for (const week of completedWeeks) {
    if (week.planned === 0) continue;

    if (week.success) {
      weeks += 1;
      counted += 1;
      sinceGrace += 1;
      continue;
    }

    if (sinceGrace >= GRACE_EVERY_N_WEEKS) {
      week.graced = true;
      graceUsed += 1;
      counted += 1;
      sinceGrace = 0;
      continue;
    }

    break;
  }

  void counted;
  return { weeks, graceUsed };
}
