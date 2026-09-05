import type {
  LoadWarning,
  ProposedCommitment,
  WeeklyDomain,
  WeeklyPlanProposal,
} from './weekly.schema';

// =============================================================================
// "You already have eight recurring commitments" (issue #80, epic E10)
// =============================================================================
//
// PURE, and its warnings are DATA. PRD §48 asks the product to estimate total
// intentional effort and to say, when the week is getting heavy, "I recommend
// replacing something rather than adding another habit" — a recommendation.
// VISION §26 is about preventing goal overload, and a product that refuses to
// let a person plan the week they want is a different kind of overload.
//
// So nothing here blocks. `approve` requires the warnings to be acknowledged,
// which means the user has read them, not that the software agreed.
//
// RECURRING COUNTS ARE PER ROUTINE, NOT PER OCCURRENCE. Five morning focus
// blocks are one habit. Counting occurrences would put every weekday routine
// over an eight-commitment cap on its own, and the warning would fire on every
// realistic week until people learned to ignore it.
// =============================================================================

/** A weekday budget times five. Weekends are not a capacity promise. */
const WEEKDAYS_PER_WEEK = 5;

export interface LoadCheckOptions {
  softCap: number;
  /** The user's stated weekday minutes, or null when they never answered. */
  weekdayMinutes: number | null;
}

export interface LoadCheckResult {
  summary: WeeklyPlanProposal['summary'];
  warnings: LoadWarning[];
}

export function checkLoad(
  items: ProposedCommitment[],
  { softCap, weekdayMinutes }: LoadCheckOptions,
): LoadCheckResult {
  const included = items.filter((item) => item.include);

  const routineIds = new Set(
    included
      .filter((item) => item.source === 'routine' && item.routineId !== null)
      .map((item) => item.routineId as string),
  );
  const recurringExtras = included.filter(
    (item) => item.source === 'extra' && item.recurring,
  ).length;

  const recurringCount = routineIds.size + recurringExtras;
  const estimatedMinutes = included.reduce((total, item) => total + item.estimatedMinutes, 0);
  const capacityMinutes =
    weekdayMinutes === null ? null : weekdayMinutes * WEEKDAYS_PER_WEEK;

  const byDomain = {} as Record<WeeklyDomain, { count: number; minutes: number }>;
  for (const domain of ['WORK', 'FAMILY', 'HEALTH'] as WeeklyDomain[]) {
    const rows = included.filter((item) => item.domain === domain);
    byDomain[domain] = {
      count: rows.length,
      minutes: rows.reduce((total, item) => total + item.estimatedMinutes, 0),
    };
  }

  const warnings: LoadWarning[] = [];

  if (recurringCount > softCap) {
    warnings.push({
      code: 'RECURRING_OVER_CAP',
      // PRD §48's sentence, with the real count.
      message:
        `You already have ${recurringCount} recurring commitments this week. ` +
        'I recommend replacing something rather than adding another habit.',
      suggestion: 'Untick one recurring commitment or move it to a later week.',
      detail: { recurringCount, softCap },
    });
  }

  if (capacityMinutes !== null && estimatedMinutes > capacityMinutes) {
    warnings.push({
      code: 'MINUTES_OVER_CAPACITY',
      message:
        `This week adds up to about ${formatDuration(estimatedMinutes)}; ` +
        `you told me you have about ${weekdayMinutes} minutes on a weekday.`,
      suggestion: 'Use shorter versions or drop the least important day.',
      detail: { estimatedMinutes, capacityMinutes, weekdayMinutes },
    });
  }

  if (weekdayMinutes !== null) {
    const worst = worstDay(included);

    if (worst && worst.minutes > weekdayMinutes) {
      warnings.push({
        code: 'DAY_OVER_CAPACITY',
        message:
          `${formatDuration(worst.minutes)} is planned for ${worst.date}, ` +
          `more than the ${weekdayMinutes} minutes you usually have.`,
        suggestion: 'Move one of that day’s commitments to a lighter day.',
        detail: { date: worst.date, minutes: worst.minutes, weekdayMinutes },
      });
    }
  }

  return {
    summary: {
      recurringCount,
      estimatedMinutes,
      byDomain,
      softCap,
      capacityMinutes,
    },
    warnings,
  };
}

/**
 * The single heaviest day, or nothing.
 *
 * ONE warning, not one per day: a week with three heavy days would otherwise
 * produce three alerts saying the same thing, and a screen of alerts is a
 * screen nobody reads.
 */
function worstDay(
  included: ProposedCommitment[],
): { date: string; minutes: number } | null {
  const byDate = new Map<string, number>();

  for (const item of included) {
    byDate.set(item.date, (byDate.get(item.date) ?? 0) + item.estimatedMinutes);
  }

  let worst: { date: string; minutes: number } | null = null;
  for (const [date, minutes] of byDate) {
    if (worst === null || minutes > worst.minutes) worst = { date, minutes };
  }

  return worst;
}

/** "4h 20m", "50m". Minutes alone read as a number to do arithmetic on. */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
