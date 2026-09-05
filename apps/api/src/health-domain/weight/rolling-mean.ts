// =============================================================================
// The weight trend (issue #113, epic E09)
// =============================================================================
//
// PRD §47 is unusually explicit about what this must NOT do: weight tracking is
// optional, it is about the trend, and one measurement is never a "bad day".
// Body weight moves two kilos on salt, sleep and the time of day; a product
// that reacts to a single reading is a product that teaches people to be
// afraid of their scale.
//
// So: a ROLLING SEVEN-DAY MEAN and nothing else. No per-day classification, no
// arrows, no goal, no colour. The DTO carries no field a client could use to
// judge a day even if it wanted to, and a test asserts the key list.
//
// `null` UNDER TWO VALUES IS THE OTHER HALF OF THAT. A "trend" drawn through
// one point is a line the user will read as a direction, and it has none. The
// chart leaves a gap; the caption says "log a few more days".
//
// Pure — no clock, no Prisma. It is arithmetic, and it is the kind of
// arithmetic that is wrong in interesting ways at month boundaries.
// =============================================================================

export interface WeightPoint {
  /** `YYYY-MM-DD` in the user's own timezone. */
  dateLocal: string;
  weightKg: number;
}

export interface TrendPoint {
  dateLocal: string;
  /** The mean of the previous 7 calendar days including this one, or null. */
  rolling7Kg: number | null;
}

/** The default window, in calendar days. */
export const TREND_WINDOW_DAYS = 7;

/** Below this many readings inside the window there is no trend to report. */
export const MIN_POINTS_FOR_TREND = 2;

export function addDays(dateLocal: string, days: number): string {
  const [year, month, day] = dateLocal.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);

  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / (24 * 3600_000),
  );
}

/**
 * One trend value per calendar day in `[from, to]`, inclusive.
 *
 * Every day, not only the logged ones: a chart that skipped unlogged days would
 * compress a fortnight of silence into the same horizontal distance as a
 * fortnight of daily readings, and the line would lie about the slope.
 */
export function rollingMean(
  items: WeightPoint[],
  from: string,
  to: string,
  window = TREND_WINDOW_DAYS,
): TrendPoint[] {
  const byDate = new Map(items.map((item) => [item.dateLocal, item.weightKg]));
  const total = daysBetween(from, to);

  if (total < 0) return [];

  const trend: TrendPoint[] = [];

  for (let offset = 0; offset <= total; offset += 1) {
    const dateLocal = addDays(from, offset);
    const values: number[] = [];

    for (let back = 0; back < window; back += 1) {
      const value = byDate.get(addDays(dateLocal, -back));

      if (value !== undefined) values.push(value);
    }

    trend.push({
      dateLocal,
      rolling7Kg:
        values.length >= MIN_POINTS_FOR_TREND
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
          : null,
    });
  }

  return trend;
}

export interface TrendSummary {
  /** The first non-null rolling value in the window. */
  first: number;
  /** The last non-null rolling value in the window. */
  last: number;
  /** `last - first`, to one decimal. Negative is downward; nothing says "good". */
  deltaKg: number;
  /** How many days the user actually logged. */
  days: number;
}

/** Null when there is not enough to say anything, which is a state, not an error. */
export function summarise(trend: TrendPoint[], logged: number): TrendSummary | null {
  const values = trend
    .map((point) => point.rolling7Kg)
    .filter((value): value is number => value !== null);

  if (values.length < MIN_POINTS_FOR_TREND) return null;

  const first = values[0];
  const last = values[values.length - 1];

  return {
    first,
    last,
    deltaKg: Math.round((last - first) * 10) / 10,
    days: logged,
  };
}
