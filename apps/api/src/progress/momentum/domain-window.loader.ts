import { Injectable } from '@nestjs/common';

import { Trace } from '../../common/decorators/trace.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { DOMAINS } from '../../path/domain.schema';
import { safeTimeZone } from '../../today/local-date';
import { UserProfileService } from '../../user-profile/user-profile.service';
import type { Domain, DomainWindow, WindowCommitment } from './momentum-engine';
import { WINDOW_DAYS } from './momentum-engine';
import { RECOVERY_LOOKBACK_DAYS as HISTORY_DAYS } from './recovery-latency';

// =============================================================================
// Prisma → the engine's input (issue #98, epic E11)
// =============================================================================
//
// The ONLY Prisma touchpoint in this module. Everything downstream is a pure
// function over what this returns, which is what makes the state machine
// testable without a database — the same split `today/nba` uses.
//
// One `findMany` for 90 days of commitments, not one per domain: the run and
// the recovery median are cross-domain and the momentum windows are slices of
// the same rows, so three queries would be three chances for them to disagree.
// =============================================================================

const DAY_MS = 24 * 3_600_000;

export interface LoadedWindows {
  timeZone: string;
  now: Date;
  /** 28-day slices, one per domain, ready for `computeMomentum`. */
  windows: Record<Domain, DomainWindow>;
  /** 90 days, all domains — what the run and the latency median read. */
  history: WindowCommitment[];
}

@Injectable()
export class DomainWindowLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
  ) {}

  @Trace('progress.window.load')
  async load(userId: string, now: Date): Promise<LoadedWindows> {
    const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);

    const [profile, rows, firstCommitments, firstEvidence] = await Promise.all([
      this.profiles.find(userId),
      this.prisma.commitment.findMany({
        where: { userId, scheduledStart: { gte: since } },
        select: {
          id: true,
          domain: true,
          scheduledStart: true,
          status: true,
          rescheduleCount: true,
          versionUsed: true,
          completedAt: true,
          commitmentType: true,
        },
        orderBy: { scheduledStart: 'asc' },
      }),
      this.prisma.commitment.groupBy({
        by: ['domain'],
        where: { userId },
        _min: { scheduledStart: true },
      }),
      this.prisma.evidence.findMany({
        where: { userId, commitment: { isNot: null } },
        select: { occurredAt: true, commitment: { select: { domain: true } } },
        orderBy: { occurredAt: 'asc' },
        take: 1_000,
      }),
    ]);

    const timeZone = safeTimeZone(profile?.timezone);
    const history = (rows ?? []).map(toWindowCommitment);
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

    const firstActivity = this.firstActivityByDomain(firstCommitments, firstEvidence);

    const windows = Object.fromEntries(
      DOMAINS.map((domain) => [
        domain,
        {
          domain,
          now,
          timeZone,
          firstActivityAt: firstActivity[domain as Domain] ?? null,
          // NO UPPER BOUND, deliberately. `isDecided` is the authority on
          // what counts, and it already excludes a still-open row whose time
          // has not come. Filtering on `scheduledStart < now` here as well
          // dropped something COMPLETED EARLY — which is exactly what the
          // comeback restart is (scheduled an hour out, done immediately) and
          // what any user who finishes this evening's run at lunchtime
          // produces. A completion the engine cannot see is a completion the
          // user did and the product denies.
          commitments: history.filter(
            (row) => row.domain === domain && row.scheduledStart >= windowStart,
          ),
        } satisfies DomainWindow,
      ]),
    ) as Record<Domain, DomainWindow>;

    return { timeZone, now, windows, history };
  }

  /**
   * The earliest trace of the user in each domain.
   *
   * Evidence as well as commitments, because evidence outlives its commitment
   * (`commitment_id` is SetNull) and a user whose first week was logged rather
   * than planned is not a new user.
   */
  private firstActivityByDomain(
    commitments: Array<{ domain: string; _min: { scheduledStart: Date | null } }>,
    evidence: Array<{ occurredAt: Date; commitment: { domain: string } | null }>,
  ): Partial<Record<Domain, Date>> {
    const first: Partial<Record<Domain, Date>> = {};

    const consider = (domain: string | undefined, at: Date | null | undefined) => {
      if (!domain || !at) return;
      const key = domain as Domain;
      if (!first[key] || at < first[key]!) first[key] = at;
    };

    for (const row of commitments ?? []) consider(row.domain, row._min?.scheduledStart);
    for (const row of evidence ?? []) consider(row.commitment?.domain, row.occurredAt);

    return first;
  }
}

/**
 * `versionUsed` is the wire; `fallbackUsed` is the meaning.
 *
 * SHORT and MINIMUM are both fallbacks and both are completions (PRD §44, P7).
 * The engine never sees the enum, so no rule downstream can accidentally treat
 * a short version as a lesser kind of done.
 */
export function toWindowCommitment(row: {
  id: string;
  domain: string;
  scheduledStart: Date;
  status: string;
  rescheduleCount: number;
  versionUsed: string | null;
  completedAt: Date | null;
  commitmentType: string | null;
}): WindowCommitment {
  return {
    id: row.id,
    domain: row.domain as Domain,
    scheduledStart: row.scheduledStart,
    status: row.status as WindowCommitment['status'],
    rescheduleCount: row.rescheduleCount,
    fallbackUsed: row.versionUsed === 'SHORT' || row.versionUsed === 'MINIMUM',
    completedAt: row.completedAt,
    commitmentType: row.commitmentType,
  };
}
