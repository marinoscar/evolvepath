import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Commitment, Domain as PrismaDomain } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { versionsOf } from '../../commitments/commitment-card.mapper';
import { DOMAINS } from '../../path/domain.schema';
import { CHECK_IN_READER, type CheckInReader } from '../check-in-reader';
import { localDate, localDayBounds, safeTimeZone } from '../local-date';
import type {
  CandidateCommitment,
  Domain,
  DomainModeValue,
  ScoringContext,
} from './nba-scorer';

// =============================================================================
// Everything the engine needs, read once (issue #38, epic E05)
// =============================================================================
//
// THE ONLY PLACE IN THIS MODULE THAT TOUCHES THE DATABASE. The scorer, the sizer
// and the mode resolver are pure; this service is what makes them so. Keeping
// the boundary here is what lets a ranking be reproduced from a fixture in a
// test rather than from a database state nobody can reconstruct.
// =============================================================================

/** The budget assumed for a user who has not told us their weekday minutes. */
export const DEFAULT_WEEKDAY_MINUTES = 60;

/** How far back "recently" reaches for the mode resolver's counts. */
const REINFORCE_WINDOW_DAYS = 7;
const CHALLENGE_WINDOW_DAYS = 14;

export interface TodayCandidates {
  dateLocal: string;
  timeZone: string;
  dayStart: Date;
  dayEnd: Date;
  context: ScoringContext;
  candidates: CandidateCommitment[];
  /** Every commitment of the day, paused domains included — for the cards. */
  rows: Commitment[];
  domainModes: Record<Domain, DomainModeValue>;
  /** The outcome facts the rationale and mode resolver read. */
  outcomeById: Map<string, { motivation: string | null; successDefinition: string | null }>;
  daysSinceLastEvidence: number | null;
  hasAnyEvidence: boolean;
  completionsLast7Days: number;
  missesLast7Days: number;
  routineFailuresLast14Days: Map<string, number>;
}

@Injectable()
export class CandidateLoaderService {
  private readonly logger = new Logger(CandidateLoaderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHECK_IN_READER) private readonly checkIns: CheckInReader,
  ) {}

  async load(userId: string, now: Date): Promise<TodayCandidates> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true, weekdayMinutes: true },
    });

    const rawZone = profile?.timezone ?? null;
    const timeZone = safeTimeZone(rawZone);
    if (rawZone && timeZone !== rawZone) {
      // Warn, do not throw: a bad stored zone must not take the Today screen down.
      this.logger.warn(
        `today.timezone_invalid user=${userId} stored=${rawZone} using=${timeZone}`,
      );
    }

    const dateLocal = localDate(now, timeZone);
    const { start: dayStart, end: dayEnd } = localDayBounds(dateLocal, timeZone);

    const [rows, modeRows, checkIn] = await Promise.all([
      this.prisma.commitment.findMany({
        where: {
          userId,
          // Yesterday's rows are never candidates: VISION §33 refuses catch-up
          // debt, and E11's comeback loop is what closes them.
          scheduledStart: { gte: dayStart, lt: dayEnd },
        },
        orderBy: { scheduledStart: 'asc' },
      }),
      this.prisma.domainMode.findMany({ where: { userId } }),
      this.checkIns.readForDate(userId, dateLocal),
    ]);

    // A missing row means GROW. The API synthesises it rather than seeding, so
    // a user who has never touched domain modes still has three.
    const domainModes = Object.fromEntries(
      DOMAINS.map((domain) => [
        domain,
        modeRows.find((row) => row.domain === (domain as PrismaDomain))?.mode ?? 'GROW',
      ]),
    ) as Record<Domain, DomainModeValue>;

    const outcomeIds = [...new Set(rows.map((row) => row.outcomeId).filter(Boolean))] as string[];
    const [outcomes, activeVersionIds] = await Promise.all([
      outcomeIds.length
        ? this.prisma.outcome.findMany({
            where: { id: { in: outcomeIds }, userId },
            select: {
              id: true,
              motivation: true,
              successDefinition: true,
              targetDate: true,
              plan: { select: { id: true } },
            },
          })
        : Promise.resolve([]),
      this.loadActiveVersionIds(userId, rows),
    ]);

    const outcomeById = new Map(
      outcomes.map((outcome) => [
        outcome.id,
        { motivation: outcome.motivation, successDefinition: outcome.successDefinition },
      ]),
    );
    const outcomeTargetById = new Map(
      outcomes.map((outcome) => [outcome.id, outcome.targetDate]),
    );
    const outcomePlanById = new Map(
      outcomes.map((outcome) => [outcome.id, outcome.plan?.id ?? null]),
    );

    const started = rows.find((row) => row.status === 'STARTED') ?? null;

    const completedToday = rows.filter(
      (row) => row.status === 'COMPLETED' || row.status === 'PARTIALLY_COMPLETED',
    );

    const completedTodayByDomain = Object.fromEntries(
      DOMAINS.map((domain) => [
        domain,
        completedToday.filter((row) => row.domain === (domain as PrismaDomain)).length,
      ]),
    ) as Record<Domain, number>;

    const minutesUsedToday = completedToday.reduce(
      (total, row) => total + (row.minutesSpent ?? 0),
      0,
    );

    const context: ScoringContext = {
      now,
      checkIn,
      domainModes,
      completedTodayByDomain,
      availableMinutesRemaining: Math.max(
        0,
        (profile?.weekdayMinutes ?? DEFAULT_WEEKDAY_MINUTES) - minutesUsedToday,
      ),
      startedCommitmentId: started?.id ?? null,
    };

    const candidates = rows
      // PAUSE never reaches the scorer. The domain still gets a card — the user
      // chose to put it down, and hiding it entirely would look like data loss.
      .filter((row) => domainModes[row.domain as Domain] !== 'PAUSE')
      .filter(
        (row) => row.status === 'PLANNED' || row.status === 'READY' || row.status === 'STARTED',
      )
      .map((row) => this.toCandidate(row, activeVersionIds, outcomeTargetById, outcomePlanById));

    const history = await this.loadHistory(userId, now, rows);

    return {
      dateLocal,
      timeZone,
      dayStart,
      dayEnd,
      context,
      candidates,
      rows,
      domainModes,
      outcomeById,
      ...history,
    };
  }

  private toCandidate(
    row: Commitment,
    activeVersionIds: Set<string>,
    outcomeTargetById: Map<string, Date | null>,
    outcomePlanById: Map<string, string | null>,
  ): CandidateCommitment {
    const planId = row.outcomeId ? (outcomePlanById.get(row.outcomeId) ?? null) : null;

    return {
      id: row.id,
      domain: row.domain as Domain,
      importance: row.importance,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      status: row.status as 'PLANNED' | 'READY' | 'STARTED',
      rescheduleCount: row.rescheduleCount,
      planId,
      planIsActive: row.planVersionId ? activeVersionIds.has(row.planVersionId) : false,
      outcomeTargetDate: row.outcomeId ? (outcomeTargetById.get(row.outcomeId) ?? null) : null,
      versions: versionsOf(row),
      createdAt: row.createdAt,
    };
  }

  /** Which of today's plan versions are the ones currently in force. */
  private async loadActiveVersionIds(
    userId: string,
    rows: Commitment[],
  ): Promise<Set<string>> {
    const ids = [...new Set(rows.map((row) => row.planVersionId).filter(Boolean))] as string[];
    if (ids.length === 0) return new Set();

    const versions = await this.prisma.planVersion.findMany({
      where: { id: { in: ids }, userId, status: 'ACTIVE' },
      select: { id: true },
    });

    return new Set(versions.map((version) => version.id));
  }

  /**
   * The counts the intervention-mode resolver needs.
   *
   * Deliberately four small aggregates rather than one big join: each answers a
   * different question over a different window, and a single query would have to
   * over-fetch to serve all of them.
   */
  private async loadHistory(
    userId: string,
    now: Date,
    todayRows: Commitment[],
  ): Promise<{
    daysSinceLastEvidence: number | null;
    hasAnyEvidence: boolean;
    completionsLast7Days: number;
    missesLast7Days: number;
    routineFailuresLast14Days: Map<string, number>;
  }> {
    const since7 = new Date(now.getTime() - REINFORCE_WINDOW_DAYS * 86_400_000);
    const since14 = new Date(now.getTime() - CHALLENGE_WINDOW_DAYS * 86_400_000);
    const routineIds = [...new Set(todayRows.map((row) => row.routineId).filter(Boolean))] as string[];

    const [lastEvidence, completions, misses, routineFailures] = await Promise.all([
      this.prisma.evidence.findFirst({
        where: { userId },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      this.prisma.commitment.count({
        where: {
          userId,
          status: { in: ['COMPLETED', 'PARTIALLY_COMPLETED'] },
          completedAt: { gte: since7 },
        },
      }),
      this.prisma.commitment.count({
        where: { userId, status: 'MISSED', scheduledStart: { gte: since7 } },
      }),
      routineIds.length
        ? this.prisma.commitment.groupBy({
            by: ['routineId'],
            where: {
              userId,
              routineId: { in: routineIds },
              status: { in: ['MISSED', 'SKIPPED'] },
              scheduledStart: { gte: since14 },
            },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ routineId: string | null; _count: { _all: number } }>),
    ]);

    return {
      daysSinceLastEvidence: lastEvidence
        ? Math.floor((now.getTime() - lastEvidence.occurredAt.getTime()) / 86_400_000)
        : null,
      hasAnyEvidence: lastEvidence !== null,
      completionsLast7Days: completions,
      missesLast7Days: misses,
      routineFailuresLast14Days: new Map(
        routineFailures
          .filter((group) => group.routineId !== null)
          .map((group) => [group.routineId as string, group._count._all]),
      ),
    };
  }
}
