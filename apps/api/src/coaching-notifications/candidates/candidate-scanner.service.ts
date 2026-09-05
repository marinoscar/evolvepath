// =============================================================================
// What might be worth saying, right now (issue #59, epic E12)
// =============================================================================
//
// The scanner turns the state of the world into `NotificationCandidate`s. It
// makes NO decision — every candidate it produces still goes through `decide()`,
// which is why this file may be generous and the policy strict. Splitting them
// that way is what makes "we would have told you, but you were asleep" a
// recordable fact rather than an absence.
//
// -----------------------------------------------------------------------------
// THE WINDOW, AND WHY IT OVERLAPS THE CRON INTERVAL
// -----------------------------------------------------------------------------
//
// The cron runs every five minutes; the window is 45 minutes behind to 30
// minutes ahead. So each candidate is seen by several consecutive runs, on
// purpose: a run that fails, a process that restarts, or a clock that drifts
// must not lose a moment permanently. The `(user, event, dedupeKey)` unique
// index is what makes that safe — the FIRST run to reach a candidate records
// the decision and every later run finds it already made.
//
// That is also why `hasDecision` is checked here, before any work: it is an
// optimisation, not the correctness mechanism. The index is the correctness
// mechanism, and it holds even when two runs overlap.
//
// -----------------------------------------------------------------------------
// ONE MOMENT, ONE MESSAGE
// -----------------------------------------------------------------------------
//
// N1, N3 and N5 all fire in roughly the same pre-commitment window, and a user
// with an avoided family ritual must not get three notifications about it. They
// are therefore mutually exclusive AT SOURCE rather than being left for the
// per-commitment cap to trim: the cap would let two through on a quiet day, and
// the second would be a worse-worded duplicate of the first.
//
//   FAMILY domain            -> N5   (presence, "I'm in")
//   moved at least once      -> N3   (rescue, the minimum version)
//   otherwise                -> N1   (plain upcoming)

import { Injectable, Logger } from '@nestjs/common';
import type { Commitment, CommitmentStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { localDate, localDayBounds, localWeekBounds } from '../../today/local-date';
import { COACHING_CATEGORY } from '../coaching-events';
import {
  evidenceMilestone,
  milestoneCount,
  MILESTONE_WINDOW_DAYS,
} from '../policy/evidence-milestones';
import type { NotificationCandidate } from './notification-candidate';

/** How far behind and ahead of `now` a commitment may be and still be scanned. */
export const SCAN_BEHIND_MS = 45 * 60_000;
export const SCAN_AHEAD_MS = 30 * 60_000;

/** N1/N3: "starts in about twenty minutes". */
const UPCOMING_MIN_MS = 10 * 60_000;
const UPCOMING_MAX_MS = 25 * 60_000;

/** N5: family rituals get a slightly tighter window — they need less warning. */
const FAMILY_MIN_MS = 10 * 60_000;
const FAMILY_MAX_MS = 20 * 60_000;

/** N2: "due now", either side. */
const START_CUE_MS = 5 * 60_000;

/** N7: a completion is only news for a few minutes. */
const CELEBRATION_WINDOW_MS = 15 * 60_000;

/** The hour after which the day's whole-day categories may fire. */
const DAY_END_HOUR = 22;

/**
 * Every status a commitment in the window may hold — including the terminal
 * ones, and that is the point.
 *
 * The obvious scan is "rows that still need doing". It is wrong, because the
 * most valuable thing this engine records is what it DIDN'T say and why: a
 * commitment the user skipped this morning has to reach `decide()` so the
 * `SKIPPED` suppression is written, and a completed one has to reach it so the
 * start cue is recorded as `ALREADY_DONE` rather than simply never happening.
 * Filtering them out here would make the two commonest suppress reasons
 * unreachable and the metrics quietly wrong.
 */
const SCANNED_STATUSES: CommitmentStatus[] = [
  'PLANNED',
  'READY',
  'RESCHEDULED',
  'STARTED',
  'SKIPPED',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'MISSED',
  'CANCELLED',
];

type ScanRow = Commitment;

interface UserContext {
  userId: string;
  timeZone: string;
  dateLocal: string;
  quietStart: string | null;
}

@Injectable()
export class CandidateScannerService {
  private readonly logger = new Logger(CandidateScannerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scan(now: Date): Promise<NotificationCandidate[]> {
    const rows = await this.prisma.commitment.findMany({
      where: {
        OR: [
          {
            scheduledStart: {
              gte: new Date(now.getTime() - SCAN_BEHIND_MS),
              lte: new Date(now.getTime() + SCAN_AHEAD_MS),
            },
            status: { in: SCANNED_STATUSES },
          },
          {
            status: 'COMPLETED',
            completedAt: { gte: new Date(now.getTime() - CELEBRATION_WINDOW_MS), lte: now },
          },
        ],
      },
      orderBy: { scheduledStart: 'asc' },
    });

    if (rows.length === 0) return [];

    const contexts = await this.loadContexts(
      [...new Set(rows.map((r) => r.userId))],
      now,
    );
    const candidates: NotificationCandidate[] = [];

    for (const row of rows) {
      const context = contexts.get(row.userId);
      if (!context) continue;

      try {
        const candidate = await this.candidateFor(row, context, now);
        if (candidate) candidates.push(candidate);
      } catch (error) {
        // One malformed row must not cost the whole run. Every other user's
        // moment is still time-sensitive.
        this.logger.warn(
          `coach-notify skipped commitment ${row.id}: ${(error as Error).message}`,
        );
      }
    }

    return this.withoutDecided(candidates);
  }

  /**
   * `now` is threaded in rather than read here — the simulated clock the
   * `run-job` route passes has to reach `localDate`, or a test that runs the
   * job "at 23:50 local" computes today's date from the real wall clock and
   * every day-scoped rule silently uses the wrong day.
   */
  private async loadContexts(
    userIds: string[],
    now: Date,
  ): Promise<Map<string, UserContext>> {
    const profiles = await this.prisma.userProfile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, timezone: true, quietHoursStart: true },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));

    return new Map(
      userIds.map((userId) => {
        // A user with no profile row still gets coaching — UTC is the same
        // fallback `local-date.ts` uses everywhere, and refusing to scan them
        // would silently exclude everybody who has not finished onboarding.
        const timeZone = byUser.get(userId)?.timezone ?? 'UTC';
        return [
          userId,
          {
            userId,
            timeZone,
            dateLocal: localDate(now, timeZone),
            quietStart: byUser.get(userId)?.quietHoursStart ?? null,
          },
        ];
      }),
    );
  }

  private async candidateFor(
    row: ScanRow,
    context: UserContext,
    now: Date,
  ): Promise<NotificationCandidate | null> {
    // A completion is news for a quarter of an hour. Outside that the row falls
    // through to the ordinary windows below, where it becomes an `ALREADY_DONE`
    // suppression rather than a message — which is the record E12-06 needs.
    if (
      row.status === 'COMPLETED' &&
      row.completedAt &&
      now.getTime() - row.completedAt.getTime() <= CELEBRATION_WINDOW_MS
    ) {
      const celebration = await this.celebrationFor(row, context, now);
      if (celebration) return celebration;
    }

    const delta = row.scheduledStart.getTime() - now.getTime();

    // N2 first: a commitment that is due NOW outranks one that is due soon,
    // and the two windows do not overlap only because this check comes first.
    if (row.status !== 'STARTED' && delta > -START_CUE_MS && delta <= START_CUE_MS) {
      return this.startCue(row, context);
    }

    if (row.status === 'STARTED') return null;

    if (row.domain === 'FAMILY') {
      if (delta > FAMILY_MIN_MS && delta <= FAMILY_MAX_MS) {
        return this.familyPresence(row, context, delta, now);
      }
      return null;
    }

    if (delta > UPCOMING_MIN_MS && delta <= UPCOMING_MAX_MS) {
      return this.avoidanceLevel(row) >= 1
        ? this.rescue(row, context)
        : this.upcoming(row, context, delta);
    }

    // N4: the moment has passed but the day has not. Only worth saying when a
    // smaller version genuinely still fits — otherwise it is a reminder that
    // the user is late, which is the thing this product does not do.
    if (delta <= 0) return this.fallbackOffer(row, context, now);

    return null;
  }

  // ---------------------------------------------------------------------------
  // N1 / N3 / N5 — before the moment
  // ---------------------------------------------------------------------------

  private upcoming(
    row: ScanRow,
    context: UserContext,
    delta: number,
  ): NotificationCandidate {
    const minutesUntil = Math.round(delta / 60_000);
    return {
      userId: row.userId,
      eventKey: 'coach.commitment_upcoming',
      category: COACHING_CATEGORY['coach.commitment_upcoming'],
      dueAt: row.scheduledStart,
      dedupeKey: row.id,
      commitmentId: row.id,
      commitment: policyCommitment(row, context),
      domain: row.domain,
      leadMinutes: minutesUntil,
      payload: {
        commitmentId: row.id,
        domain: row.domain,
        commitmentTitle: row.title,
        scheduledStart: row.scheduledStart.toISOString(),
        minutesUntil,
        startMinutes: offeredMinutes(row),
      },
    };
  }

  /**
   * N3 replaces N1 for a commitment that has already been moved.
   *
   * The interim source for "is this being avoided" is `rescheduleCount`, which
   * is the observable the E07 avoidance model is itself built on — a commitment
   * moved twice is being avoided whatever else is true. When E07-03's
   * `AvoidanceService.assessMany` lands, this method is the one seam to change:
   * everything downstream already carries a `level` field for it.
   */
  private avoidanceLevel(row: ScanRow): number {
    return Math.min(6, row.rescheduleCount);
  }

  private rescue(row: ScanRow, context: UserContext): NotificationCandidate {
    return {
      userId: row.userId,
      eventKey: 'coach.rescue',
      category: COACHING_CATEGORY['coach.rescue'],
      dueAt: row.scheduledStart,
      dedupeKey: row.id,
      commitmentId: row.id,
      commitment: policyCommitment(row, context),
      domain: row.domain,
      payload: {
        commitmentId: row.id,
        domain: row.domain,
        commitmentTitle: row.title,
        rescheduleCount: row.rescheduleCount,
        level: this.avoidanceLevel(row),
        minimumMinutes: smallestMinutes(row),
      },
    };
  }

  private async familyPresence(
    row: ScanRow,
    context: UserContext,
    delta: number,
    _now: Date,
  ): Promise<NotificationCandidate> {
    const ritual = row.ritualId
      ? await this.prisma.ritual.findUnique({
          where: { id: row.ritualId },
          select: { purpose: true },
        })
      : null;

    const member = row.familyMemberId
      ? await this.prisma.familyMember.findUnique({
          where: { id: row.familyMemberId },
          // The NICKNAME and nothing else. PRD §33 fixes the family record at
          // five fields and VISION §50 says why; a notification payload is
          // exactly the kind of place a sixth would quietly appear.
          select: { nickname: true },
        })
      : null;

    return {
      userId: row.userId,
      eventKey: 'coach.family_presence',
      category: COACHING_CATEGORY['coach.family_presence'],
      dueAt: row.scheduledStart,
      dedupeKey: row.id,
      commitmentId: row.id,
      commitment: policyCommitment(row, context),
      domain: 'FAMILY',
      leadMinutes: Math.round(delta / 60_000),
      payload: {
        commitmentId: row.id,
        commitmentTitle: row.title,
        minutesUntil: Math.round(delta / 60_000),
        ...(ritual?.purpose ? { purpose: ritual.purpose } : {}),
        ...(member?.nickname ? { familyNickname: member.nickname } : {}),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // N2 — at the moment
  // ---------------------------------------------------------------------------

  private startCue(row: ScanRow, context: UserContext): NotificationCandidate {
    const steps = Array.isArray(row.steps) ? row.steps : [];
    const first = steps[0] as { title?: unknown } | undefined;

    return {
      userId: row.userId,
      eventKey: 'coach.start_cue',
      category: COACHING_CATEGORY['coach.start_cue'],
      dueAt: row.scheduledStart,
      dedupeKey: row.id,
      commitmentId: row.id,
      commitment: policyCommitment(row, context),
      domain: row.domain,
      leadMinutes: 0,
      payload: {
        commitmentId: row.id,
        domain: row.domain,
        commitmentTitle: row.title,
        startMinutes: offeredMinutes(row),
        ...(typeof first?.title === 'string' ? { firstStep: first.title } : {}),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // N4 — after the moment, while a smaller version still fits
  // ---------------------------------------------------------------------------

  private fallbackOffer(
    row: ScanRow,
    context: UserContext,
    now: Date,
  ): NotificationCandidate | null {
    const full = row.fullMinutes ?? null;
    const short = row.shortMinutes ?? row.minimumMinutes ?? null;
    const minimum = row.minimumMinutes ?? row.shortMinutes ?? null;
    if (full === null || short === null || minimum === null) return null;

    const remaining = this.remainingMinutes(row, context, now);

    // The offer is only honest when the full version no longer fits AND the
    // smaller one does. Outside that band there is nothing to say: either
    // nothing has changed, or nothing at all fits and the right answer is
    // silence, not a message about how little time is left.
    if (remaining >= full) return null;
    if (remaining < minimum || remaining < short) return null;

    return {
      userId: row.userId,
      eventKey: 'coach.fallback_offer',
      category: COACHING_CATEGORY['coach.fallback_offer'],
      dueAt: row.scheduledStart,
      dedupeKey: row.id,
      commitmentId: row.id,
      commitment: policyCommitment(row, context),
      domain: row.domain,
      payload: {
        commitmentId: row.id,
        domain: row.domain,
        commitmentTitle: row.title,
        fullMinutes: full,
        shortMinutes: short,
        remainingMinutes: remaining,
      },
    };
  }

  /**
   * How much of the day is genuinely left.
   *
   * `scheduledEnd` when the commitment has one; otherwise the end of the user's
   * usable day — the start of their quiet hours if they set any, else 22:00
   * local. Using midnight would offer a 20-minute workout at 23:40, which is
   * technically true and obviously wrong.
   */
  private remainingMinutes(row: ScanRow, context: UserContext, now: Date): number {
    if (row.scheduledEnd) {
      return Math.floor((row.scheduledEnd.getTime() - now.getTime()) / 60_000);
    }

    const { start } = localDayBounds(context.dateLocal, context.timeZone);
    const [hours, minutes] = (context.quietStart ?? `${DAY_END_HOUR}:00`)
      .split(':')
      .map(Number);
    const dayEnd = start.getTime() + (hours * 60 + minutes) * 60_000;

    return Math.floor((dayEnd - now.getTime()) / 60_000);
  }

  // ---------------------------------------------------------------------------
  // N7 — after a completion, when it is part of a pattern
  // ---------------------------------------------------------------------------

  private async celebrationFor(
    row: ScanRow,
    context: UserContext,
    now: Date,
  ): Promise<NotificationCandidate | null> {
    if (!row.outcomeId) return null;

    const outcome = await this.prisma.outcome.findUnique({
      where: { id: row.outcomeId },
      select: { title: true },
    });
    if (!outcome) return null;

    const completions = await this.prisma.commitment.findMany({
      where: {
        userId: row.userId,
        outcomeId: row.outcomeId,
        status: 'COMPLETED',
        completedAt: { not: null },
      },
      select: { completedAt: true },
      orderBy: { completedAt: 'desc' },
      take: 40,
    });

    const week = localWeekBounds(context.dateLocal, context.timeZone);
    const [weekPlanned, weekCompleted] = await Promise.all([
      this.prisma.commitment.count({
        where: {
          userId: row.userId,
          outcomeId: row.outcomeId,
          scheduledStart: { gte: week.start, lt: week.end },
        },
      }),
      this.prisma.commitment.count({
        where: {
          userId: row.userId,
          outcomeId: row.outcomeId,
          scheduledStart: { gte: week.start, lt: week.end },
          status: 'COMPLETED',
        },
      }),
    ]);

    const input = {
      completions: completions
        .map((c) => c.completedAt)
        .filter((at): at is Date => at !== null),
      now,
      totalCompletions: completions.length,
      weekPlanned,
      weekCompleted,
    };

    const milestone = evidenceMilestone(input);
    if (!milestone) return null;

    return {
      userId: row.userId,
      eventKey: 'coach.evidence',
      category: COACHING_CATEGORY['coach.evidence'],
      dueAt: row.completedAt ?? now,
      dedupeKey: row.id,
      commitmentId: row.id,
      commitment: policyCommitment(row, context),
      domain: row.domain,
      payload: {
        commitmentId: row.id,
        domain: row.domain,
        outcomeTitle: outcome.title,
        count: milestoneCount(milestone, input),
        windowDays: MILESTONE_WINDOW_DAYS[milestone] || 7,
        milestone,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // N6, N8, N9 — sources that arrive with later epics
  // ---------------------------------------------------------------------------
  //
  // Recovery reads E11-02's comeback record, the weekly review reads E10's
  // `WeeklyReview`, and the plan issue reads E06-01's `PlanChangeProposal`.
  // None of those tables exists yet. There is deliberately NO placeholder
  // source: inventing one would mean sending real users messages about
  // artefacts they cannot open.
  //
  // Everything downstream of the source is finished and tested — registry
  // entries, payload schemas, deep links, deterministic copy, the N8 email
  // template, and the decision rules (including the two `DOMAIN_EXEMPT`
  // categories, which exist precisely so recovery survives a paused domain).
  // Adding each source is one private method here plus its dedupe key, which is
  // `<sourceId>:<dateLocal>` so the candidate is retried once a day rather than
  // once ever.

  /**
   * Drop candidates whose decision has already been recorded.
   *
   * An optimisation, not the correctness mechanism — see the file header. One
   * query for the whole batch rather than one per candidate: a busy minute can
   * produce hundreds, and this runs every five minutes forever.
   */
  private async withoutDecided(
    candidates: NotificationCandidate[],
  ): Promise<NotificationCandidate[]> {
    if (candidates.length === 0) return [];

    const decided = await this.prisma.notificationInteraction.findMany({
      where: {
        OR: candidates.map((c) => ({
          userId: c.userId,
          eventKey: c.eventKey,
          dedupeKey: c.dedupeKey,
        })),
      },
      select: { userId: true, eventKey: true, dedupeKey: true },
    });

    const seen = new Set(
      decided.map((d) => `${d.userId}|${d.eventKey}|${d.dedupeKey ?? ''}`),
    );

    return candidates.filter(
      (c) => !seen.has(`${c.userId}|${c.eventKey}|${c.dedupeKey}`),
    );
  }
}

/**
 * The minutes the Start button offers.
 *
 * The SMALLEST defined version, not the full one. A notification is read in a
 * gap between other things, and the number in it is the one being agreed to —
 * offering 38 minutes when 10 would also count is how a reminder becomes
 * something to dismiss.
 */
export function offeredMinutes(row: ScanRow): number {
  return row.minimumMinutes ?? row.shortMinutes ?? row.fullMinutes ?? 10;
}

export function smallestMinutes(row: ScanRow): number {
  return row.minimumMinutes ?? row.shortMinutes ?? row.fullMinutes ?? 10;
}

/** The subset of a commitment row the policy layer is allowed to see. */
function policyCommitment(row: ScanRow, context: UserContext) {
  const day = localDayBounds(context.dateLocal, context.timeZone);
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    scheduledStart: row.scheduledStart,
    // "Skipped, and skipped TODAY". A row skipped last Tuesday and rescheduled
    // into today is a fresh question; a row skipped this morning is not.
    skippedToday:
      row.status === 'SKIPPED' &&
      row.updatedAt >= day.start &&
      row.updatedAt < day.end,
  };
}
