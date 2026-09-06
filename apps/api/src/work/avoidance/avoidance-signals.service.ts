import { Injectable } from '@nestjs/common';
import type { Commitment } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { FRICTION_ANSWER_KEYS } from './friction-answers';
import { timeWindowOf } from './time-window';
import type { AvoidanceSignals } from './avoidance-detector';

// =============================================================================
// From rows to numbers (issue #116, epic E07)
// =============================================================================
//
// THE DATES LIVE HERE, ALL OF THEM. `avoidance-detector.ts` is pure and takes
// counts; every question that involves a timezone, a day boundary or a window
// is answered in this file, once.
//
// BATCHED BY CONSTRUCTION. `GET /today` calls this on every app open, for every
// WORK commitment on the screen. `collectMany` issues a fixed number of queries
// — four — whether it is asked about one commitment or ten. A per-commitment
// loop would be a query storm on the product's most-hit endpoint, and would
// look fine in a test with one row.
// =============================================================================

/** Skips and misses are counted over a fortnight. */
export const SKIP_WINDOW_DAYS = 14;

/** The same-window signal needs three weeks to mean "keeps failing at 4 PM". */
export const WINDOW_FAILURE_DAYS = 21;

/** Having answered the friction question, do not ask again for a week. */
export const ASKED_RECENTLY_DAYS = 7;

/** A skip note that reads as "I'll do it later". `latest` must not match. */
export const EXPLICIT_LATER_PATTERN = /\b(later|tomorrow|not now)\b/i;

/** The one skip reason that IS an explicit "later" without a note. */
const AVOIDED_SKIP_REASON = 'AVOIDED';

const FAILURE_STATUSES = ['SKIPPED', 'MISSED', 'RESCHEDULED'] as const;

export interface CollectedSignals {
  signals: AvoidanceSignals;
  askedRecently: boolean;
}

@Injectable()
export class AvoidanceSignalsService {
  constructor(private readonly prisma: PrismaService) {}

  async collectMany(
    userId: string,
    commitments: Commitment[],
    now: Date,
    timezone: string,
  ): Promise<Map<string, CollectedSignals>> {
    const result = new Map<string, CollectedSignals>();

    if (commitments.length === 0) return result;

    const commitmentIds = commitments.map((c) => c.id);
    const outcomeIds = [
      ...new Set(commitments.map((c) => c.outcomeId).filter((id): id is string => Boolean(id))),
    ];

    const skipSince = new Date(now.getTime() - SKIP_WINDOW_DAYS * 86_400_000);
    const windowSince = new Date(now.getTime() - WINDOW_FAILURE_DAYS * 86_400_000);
    const askedSince = new Date(now.getTime() - ASKED_RECENTLY_DAYS * 86_400_000);

    // Four queries, whatever the batch size. See the header.
    const [outcomes, siblings, evidence, reflections] = await Promise.all([
      outcomeIds.length > 0
        ? this.prisma.outcome.findMany({
            where: { id: { in: outcomeIds }, userId },
            select: { id: true, createdAt: true },
          })
        : Promise.resolve([]),

      outcomeIds.length > 0
        ? this.prisma.commitment.findMany({
            where: {
              userId,
              domain: 'WORK',
              outcomeId: { in: outcomeIds },
              scheduledStart: { gte: windowSince },
            },
            select: {
              id: true,
              outcomeId: true,
              status: true,
              scheduledStart: true,
              skipReason: true,
              skipNote: true,
              importance: true,
              completedAt: true,
            },
          })
        : Promise.resolve([]),

      this.prisma.evidence.findMany({
        where: { userId, commitmentId: { in: commitmentIds } },
        select: { commitmentId: true },
      }),

      this.prisma.reflection.findMany({
        where: {
          userId,
          commitmentId: { in: commitmentIds },
          createdAt: { gte: askedSince },
        },
        select: { commitmentId: true, frictionTags: true },
      }),
    ]);

    const outcomeCreatedAt = new Map(outcomes.map((o) => [o.id, o.createdAt]));
    const withEvidence = new Set(evidence.map((row) => row.commitmentId));

    // A friction ANSWER, not a skip reflection: E05-02's skips carry
    // `SkipReason` keys in the same column, and they are a different question.
    const askedFor = new Set(
      reflections
        .filter((row) =>
          row.frictionTags.some((tag) =>
            (FRICTION_ANSWER_KEYS as readonly string[]).includes(tag),
          ),
        )
        .map((row) => row.commitmentId)
        .filter((id): id is string => Boolean(id)),
    );

    for (const commitment of commitments) {
      const family = siblings.filter(
        (row) => row.outcomeId === commitment.outcomeId && row.id !== commitment.id,
      );

      const recent = family.filter((row) => row.scheduledStart >= skipSince);

      const shortSkipCount = recent.filter(
        (row) => row.status === 'SKIPPED' || row.status === 'MISSED',
      ).length;

      const explicitLaterCount = recent.filter(
        (row) =>
          row.skipReason === AVOIDED_SKIP_REASON ||
          (row.skipNote !== null && EXPLICIT_LATER_PATTERN.test(row.skipNote)),
      ).length;

      const window = timeWindowOf(commitment.scheduledStart, timezone);

      const sameWindowFailureCount = family.filter(
        (row) =>
          (FAILURE_STATUSES as readonly string[]).includes(row.status) &&
          timeWindowOf(row.scheduledStart, timezone) === window,
      ).length;

      const createdAt = commitment.outcomeId
        ? (outcomeCreatedAt.get(commitment.outcomeId) ?? commitment.createdAt)
        : commitment.createdAt;

      result.set(commitment.id, {
        signals: {
          rescheduleCount: commitment.rescheduleCount,
          daysUnchanged: this.daysUnchanged(commitment, withEvidence, now),
          shortSkipCount,
          explicitLaterCount,
          displacedByLowerImportanceCount: this.displacedCount(commitment, family, timezone, now),
          sameWindowFailureCount,
          weeksOfEvidence: Math.floor(
            (now.getTime() - createdAt.getTime()) / (7 * 86_400_000),
          ),
        },
        askedRecently: askedFor.has(commitment.id),
      });
    }

    return result;
  }

  /**
   * Whole days this has sat open with nothing recorded against it.
   *
   * ZERO THE MOMENT ANY EVIDENCE EXISTS. A commitment somebody started on
   * Monday and has not finished is not untouched — it is in progress, and
   * telling them it has been ignored for four days would be false.
   */
  private daysUnchanged(
    commitment: Commitment,
    withEvidence: Set<string | null>,
    now: Date,
  ): number {
    const open = ['PLANNED', 'READY', 'RESCHEDULED'].includes(commitment.status);

    if (!open || withEvidence.has(commitment.id)) return 0;

    return Math.max(
      0,
      Math.floor((now.getTime() - commitment.createdAt.getTime()) / 86_400_000),
    );
  }

  /**
   * Days this was due and untouched while something LESS important got done.
   *
   * PRD §25's "high-priority work displaced by lower-priority completions" —
   * the signal that says the problem is not the day being full, because
   * something did get finished; it was just the easier thing.
   */
  private displacedCount(
    commitment: Commitment,
    family: Array<{
      status: string;
      scheduledStart: Date;
      importance: number;
      completedAt: Date | null;
    }>,
    timezone: string,
    now: Date,
  ): number {
    if (commitment.scheduledStart > now) return 0;

    const dueDay = dayKey(commitment.scheduledStart, timezone);

    return family.filter(
      (row) =>
        row.status === 'COMPLETED' &&
        row.importance < commitment.importance &&
        row.completedAt !== null &&
        dayKey(row.completedAt, timezone) <= dayKey(now, timezone) &&
        dayKey(row.completedAt, timezone) >= dueDay,
    ).length;
  }
}

/** `YYYY-MM-DD` in the user's zone. Comparable as a string, which is the point. */
function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
