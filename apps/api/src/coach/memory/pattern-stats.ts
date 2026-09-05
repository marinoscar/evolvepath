import { localHour } from '../../today/local-date';

// =============================================================================
// What the pattern analyst is allowed to see (issue #78, epic E06)
// =============================================================================
//
// COUNTS ONLY. No titles, no reflection text, no skip notes, no family member
// names. PRD §14.4 wants durable inferences drawn from behaviour, and the whole
// of the behaviour that matters here is "when does this person actually do the
// thing?" — which is a table of numbers.
//
// That is a privacy decision AND a quality one. Free text would let the model
// produce a statement about the user quoting something they wrote once, which
// is both more intrusive and less durable than "morning commitments are kept
// more often than evening ones".
//
// NO NEST DECORATORS, NO PRISMA. E11's momentum engine replaces this file's
// implementation and keeps its shape; keeping it a pure function over already
// fetched rows is what makes that a swap rather than a rewrite.
// =============================================================================

/** A commitment, reduced to what an aggregate needs. */
export interface StatsCommitment {
  status: string;
  domain: string;
  scheduledStart: Date;
  rescheduleCount: number;
  versionUsed: string | null;
  minutesSpent: number | null;
  fullMinutes: number | null;
  skipReason: string | null;
}

export interface Rate {
  decided: number;
  kept: number;
}

export interface PatternStats {
  /** Decided commitments in the window. Below MIN_SAMPLE nothing is proposed. */
  sampleSize: number;
  byDomain: Record<string, Rate>;
  /** 0 = Sunday … 6 = Saturday, in the user's own zone. */
  byWeekday: Record<string, Rate>;
  byTimeOfDay: Record<'morning' | 'afternoon' | 'evening', Rate>;
  /** How many commitments were pushed, bucketed by how many times. */
  rescheduleHistogram: Record<string, number>;
  /** How often a shorter size was used instead of the full one. */
  fallbackUsage: { full: number; short: number; minimum: number };
  /** Mean (planned − logged) minutes over commitments that recorded both. */
  averageDurationGapMinutes: number | null;
  /** Why the user said they skipped, by reason. */
  skipReasons: Record<string, number>;
}

/**
 * "Decided" means the user's day settled the question one way or the other.
 * CANCELLED is absent on purpose: a cancelled commitment is one that stopped
 * being asked, not one the user answered.
 */
const DECIDED = new Set([
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'MISSED',
  'SKIPPED',
]);

const KEPT = new Set(['COMPLETED', 'PARTIALLY_COMPLETED']);

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export function aggregateStats(
  commitments: StatsCommitment[],
  timezone: string,
): PatternStats {
  const stats: PatternStats = {
    sampleSize: 0,
    byDomain: {},
    byWeekday: {},
    byTimeOfDay: {
      morning: { decided: 0, kept: 0 },
      afternoon: { decided: 0, kept: 0 },
      evening: { decided: 0, kept: 0 },
    },
    rescheduleHistogram: {},
    fallbackUsage: { full: 0, short: 0, minimum: 0 },
    averageDurationGapMinutes: null,
    skipReasons: {},
  };

  let gapTotal = 0;
  let gapCount = 0;

  for (const commitment of commitments) {
    if (!DECIDED.has(commitment.status)) continue;

    const kept = KEPT.has(commitment.status);
    stats.sampleSize += 1;

    bump(stats.byDomain, commitment.domain, kept);
    bump(stats.byWeekday, weekdayIn(commitment.scheduledStart, timezone), kept);

    // The bucket is the USER'S wall clock, not the server's. A 23:30 UTC
    // completion is an afternoon one in America/Costa_Rica, and calling it
    // "evening" would produce a durable statement about this person that is
    // simply false.
    const hour = localHour(commitment.scheduledStart, timezone);
    const bucket = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    stats.byTimeOfDay[bucket].decided += 1;
    if (kept) stats.byTimeOfDay[bucket].kept += 1;

    const key = String(Math.min(commitment.rescheduleCount, 3));
    stats.rescheduleHistogram[key] = (stats.rescheduleHistogram[key] ?? 0) + 1;

    if (commitment.versionUsed === 'FULL') stats.fallbackUsage.full += 1;
    if (commitment.versionUsed === 'SHORT') stats.fallbackUsage.short += 1;
    if (commitment.versionUsed === 'MINIMUM') stats.fallbackUsage.minimum += 1;

    if (commitment.minutesSpent !== null && commitment.fullMinutes !== null) {
      gapTotal += commitment.fullMinutes - commitment.minutesSpent;
      gapCount += 1;
    }

    if (commitment.skipReason) {
      stats.skipReasons[commitment.skipReason] =
        (stats.skipReasons[commitment.skipReason] ?? 0) + 1;
    }
  }

  if (gapCount > 0) {
    stats.averageDurationGapMinutes =
      Math.round((gapTotal / gapCount) * 10) / 10;
  }

  return stats;
}

function bump(table: Record<string, Rate>, key: string, kept: boolean): void {
  const rate = (table[key] ??= { decided: 0, kept: 0 });
  rate.decided += 1;
  if (kept) rate.kept += 1;
}

function weekdayIn(at: Date, timezone: string): string {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(at)
    .split('-')
    .map(Number);

  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}
