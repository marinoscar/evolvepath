import {
  ConflictException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma, UserProfile } from '@prisma/client';

import { Trace } from '../../common/decorators/trace.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { CommitmentActionsService } from '../../commitments/actions/commitment-actions.service';
import { canTransition } from '../../commitments/commitment-transitions';
import { toCommitmentCard } from '../../commitments/commitment-card.mapper';
import type { CommitmentCard } from '../../commitments/commitment-card.schema';
import { localDate, localDayBounds, safeTimeZone } from '../../today/local-date';
import type { Domain } from '../momentum/momentum-engine';
import { MomentumService } from '../momentum/momentum.service';
import {
  CELEBRATION_BODY,
  CELEBRATION_TITLE,
  OFFER_NOTE,
} from './comeback-copy';
import {
  detectComeback,
  idleDaysOf,
  MISSES_WINDOW_DAYS,
  suggestsPlanReview,
} from './comeback-detector';
import {
  pickForDomain,
  pickRestart,
  type RestartCandidate,
  type RestartPlan,
} from './restart-picker';
import { RestartWordingService } from './restart-wording.service';
import type { ComebackCompletion, ComebackStatus } from './comeback.schema';

// =============================================================================
// The comeback loop (issue #112, epic E11)
// =============================================================================
//
// PRD §136: Miss → Slip → No shame → Reduce scope → Restart → Record recovery.
// VISION §33: no catch-up debt.
//
// THE SWEEP CHANGES STATUS AND NOTHING ELSE. `evidence_items` is never written,
// updated or deleted here — what the user actually did is a fact, and closing a
// stale intention must not touch it. That is the difference between "we tidied
// your list" and "we edited your history".
//
// A `STARTED` row is left alone on purpose: the matrix has no `STARTED → MISSED`
// (E02-04), and it should not. Something you began and did not finish is
// PARTIALLY_COMPLETED or SKIPPED, and only the user knows which.
// =============================================================================

const DAY_MS = 24 * 3_600_000;
/** Latest local hour a restart is scheduled for — a 23:00 offer is a taunt. */
const LATEST_RESTART_HOUR = 21;
/** How far ahead "your next commitment" looks after a comeback. */
const NEXT_COMMITMENT_DAYS = 7;

export interface SweepResult {
  closedCount: number;
  trigger: 'INACTIVITY' | 'REPEATED_MISSES' | null;
  comebackState: 'NONE' | 'OFFERED' | 'IN_PROGRESS';
}

@Injectable()
export class ComebackService {
  private readonly logger = new Logger(ComebackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
    private readonly momentum: MomentumService,
    private readonly actions: CommitmentActionsService,
    private readonly wording: RestartWordingService,
  ) {}

  // ---------------------------------------------------------------------------
  // The sweep
  // ---------------------------------------------------------------------------

  @Trace('comeback.sweep')
  async sweepUser(userId: string, now: Date = new Date()): Promise<SweepResult> {
    const profile = await this.profiles.getOrCreate(userId);
    const timeZone = safeTimeZone(profile.timezone);
    const startOfToday = localDayBounds(localDate(now, timeZone), timeZone).start;

    const closedCount = await this.closeStaleCommitments(userId, startOfToday);

    const [missedLast7, missedLast14, hasHistory] = await Promise.all([
      this.missedSince(userId, new Date(now.getTime() - MISSES_WINDOW_DAYS * DAY_MS)),
      this.missedSince(userId, new Date(now.getTime() - 14 * DAY_MS)),
      this.hasHistory(userId),
    ]);

    const trigger = detectComeback({
      now,
      lastActiveAt: profile.lastActiveAt,
      hasHistory,
      missedLast7,
      comebackState: profile.comebackState,
    });

    if (!trigger) {
      await this.prisma.userProfile.update({
        where: { userId },
        data: { lastSweepAt: now },
      });

      if (closedCount > 0) {
        await this.audit(userId, 'comeback:sweep', { closedCount, trigger: null });
      }

      return { closedCount, trigger: null, comebackState: profile.comebackState };
    }

    const restart = await this.buildRestart(userId, profile, now);
    const idleDays = idleDaysOf(now, profile.lastActiveAt);
    const composed = await this.wording.compose(
      userId,
      restart,
      String(profile.coachingStyle ?? 'BALANCED'),
      idleDays,
    );

    const commitment = await this.createRestartCommitment(
      userId,
      restart,
      composed.title,
      now,
      timeZone,
    );

    const planReviewSuggested = suggestsPlanReview(missedLast14, closedCount);

    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        comebackState: 'OFFERED',
        comebackTrigger: trigger,
        comebackOfferedAt: now,
        comebackCommitmentId: commitment.id,
        lastSweepAt: now,
        ...(planReviewSuggested ? { planReviewSuggestedAt: now } : {}),
      },
    });

    await this.audit(userId, 'comeback:sweep', { closedCount, trigger });
    // Never the title: an audit row is read by an operator, and the copy is the
    // one part of this feature that is about the user's private plan.
    await this.audit(userId, 'comeback:offer', {
      trigger,
      domain: restart.domain,
      routineId: restart.routineId,
      minutes: restart.minutes,
      wording: composed.source,
      planReviewSuggested,
    });

    return { closedCount, trigger, comebackState: 'OFFERED' };
  }

  /**
   * Turn stale intentions into history.
   *
   * `canTransition` is consulted rather than trusted from the WHERE clause: the
   * matrix is the single definition of what may happen to a commitment, and a
   * sweep that wrote statuses around it would be a second, unreviewed one.
   */
  private async closeStaleCommitments(
    userId: string,
    startOfToday: Date,
  ): Promise<number> {
    const stale = await this.prisma.commitment.findMany({
      where: {
        userId,
        status: { in: ['PLANNED', 'READY'] },
        scheduledStart: { lt: startOfToday },
      },
      select: { id: true, status: true },
    });

    const closable = stale.filter((row) => {
      if (canTransition(row.status, 'MISSED')) return true;
      this.logger.warn(`comeback sweep skipped ${row.id}: ${row.status} → MISSED is not allowed`);
      return false;
    });

    if (closable.length === 0) return 0;

    // NO EVIDENCE IS WRITTEN OR TOUCHED. Not an omission — PRD §109 requires
    // prior misses to remain evidence, and a status change is the whole of
    // what "close as historical" means here.
    await this.prisma.commitment.updateMany({
      where: { id: { in: closable.map((row) => row.id) } },
      data: { status: 'MISSED' },
    });

    return closable.length;
  }

  private async missedSince(userId: string, since: Date): Promise<number> {
    return this.prisma.commitment.count({
      where: { userId, status: 'MISSED', scheduledStart: { gte: since } },
    });
  }

  private async hasHistory(userId: string): Promise<boolean> {
    const [commitments, evidence] = await Promise.all([
      this.prisma.commitment.count({ where: { userId } }),
      this.prisma.evidence.count({ where: { userId } }),
    ]);

    return commitments > 0 || evidence > 0;
  }

  // ---------------------------------------------------------------------------
  // Choosing what to offer
  // ---------------------------------------------------------------------------

  /** The user's active routines, joined to what momentum knows about them. */
  private async loadCandidates(
    userId: string,
    now: Date,
  ): Promise<RestartCandidate[]> {
    const [outcomes, modes, momentum] = await Promise.all([
      this.prisma.outcome.findMany({
        where: { userId, state: 'ACTIVE' },
        select: {
          id: true,
          title: true,
          domain: true,
          importance: true,
          plan: {
            select: {
              versions: {
                where: { status: 'ACTIVE' },
                select: {
                  id: true,
                  routines: {
                    where: { active: true },
                    select: {
                      id: true,
                      title: true,
                      domain: true,
                      minimumDurationMin: true,
                      fallbackBehavior: true,
                      preferredTime: true,
                      sortOrder: true,
                    },
                    orderBy: { sortOrder: 'asc' },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.domainMode.findMany({ where: { userId } }),
      this.momentum.forUser(userId, now).catch(() => null),
    ]);

    const modeOf = (domain: string) =>
      modes.find((mode) => mode.domain === domain)?.mode ?? 'GROW';

    const candidates: RestartCandidate[] = [];

    for (const outcome of outcomes ?? []) {
      const version = outcome.plan?.versions?.[0];
      if (!version) continue;

      for (const routine of version.routines ?? []) {
        candidates.push({
          domain: routine.domain as Domain,
          mode: modeOf(routine.domain),
          outcomeId: outcome.id,
          outcomeTitle: outcome.title,
          outcomeImportance: outcome.importance,
          planVersionId: version.id,
          routineId: routine.id,
          routineTitle: routine.title,
          minimumDurationMin: routine.minimumDurationMin,
          fallbackBehavior: routine.fallbackBehavior,
          preferredTime: routine.preferredTime,
          lastCompletionAt:
            momentum?.[routine.domain as Domain]?.signals.lastCompletionAt ?? null,
        });
      }
    }

    return candidates;
  }

  private async buildRestart(
    userId: string,
    _profile: UserProfile,
    now: Date,
  ): Promise<RestartPlan> {
    return pickRestart(await this.loadCandidates(userId, now));
  }

  /**
   * The restart row.
   *
   * Scheduled for the routine's own preferred time when that is still ahead,
   * otherwise an hour from now — and never past 21:00 local, because an offer
   * a user cannot act on before bed is a reminder that they did not.
   */
  private async createRestartCommitment(
    userId: string,
    restart: RestartPlan,
    title: string,
    now: Date,
    timeZone: string,
  ) {
    const scheduledStart = this.scheduleRestart(now, timeZone, restart.preferredTime);
    const minimumMinutes = Math.min(5, restart.minutes);

    const row = await this.prisma.commitment.create({
      data: {
        userId,
        domain: restart.domain,
        title,
        outcomeId: restart.outcomeId,
        planVersionId: restart.planVersionId,
        routineId: restart.routineId,
        scheduledStart,
        importance: 3,
        commitmentType: 'restart',
        fullVersion: title,
        fullMinutes: restart.minutes,
        minimumVersion: title,
        minimumMinutes,
        status: 'PLANNED',
        userConfirmed: false,
      },
    });

    // NO EVIDENCE ROW: creating a commitment is a plan, and PRD §10.9 forbids
    // pretending a planned item is evidence that anything happened.
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'commitment:create',
        targetType: 'commitment',
        targetId: row.id,
        meta: {
          domain: row.domain,
          planVersionId: row.planVersionId,
          routineId: row.routineId,
          commitmentType: 'restart',
        },
      },
    });

    return row;
  }

  private scheduleRestart(
    now: Date,
    timeZone: string,
    preferredTime: string | null,
  ): Date {
    const { start } = localDayBounds(localDate(now, timeZone), timeZone);
    const inAnHour = new Date(now.getTime() + 3_600_000);
    const latest = new Date(start.getTime() + LATEST_RESTART_HOUR * 3_600_000);

    let candidate = inAnHour;

    if (preferredTime && /^\d{2}:\d{2}$/.test(preferredTime)) {
      const [hours, minutes] = preferredTime.split(':').map(Number);
      const atPreferred = new Date(start.getTime() + (hours * 60 + minutes) * 60_000);
      if (atPreferred > inAnHour) candidate = atPreferred;
    }

    return candidate > latest ? latest : candidate;
  }

  // ---------------------------------------------------------------------------
  // The four routes
  // ---------------------------------------------------------------------------

  async getStatus(userId: string, now: Date = new Date()): Promise<ComebackStatus> {
    const profile = await this.profiles.getOrCreate(userId);

    if (profile.comebackState === 'NONE') {
      return {
        state: 'NONE',
        trigger: null,
        offeredAt: null,
        idleDays: null,
        closedCount: 0,
        planReviewSuggested: profile.planReviewSuggestedAt !== null,
        restart: null,
        recommendation: null,
        alternatives: [],
        wording: { note: OFFER_NOTE },
      };
    }

    const [restart, candidates] = await Promise.all([
      profile.comebackCommitmentId
        ? this.prisma.commitment.findFirst({
            where: { id: profile.comebackCommitmentId, userId },
          })
        : Promise.resolve(null),
      this.loadCandidates(userId, now),
    ]);

    const plan = pickRestart(candidates);
    const offeredDomain = (restart?.domain ?? plan.domain) as Domain;
    const alternatives = plan.alternatives.filter((alt) => alt.domain !== offeredDomain);

    const closedCount = profile.comebackOfferedAt
      ? await this.prisma.commitment.count({
          where: {
            userId,
            status: 'MISSED',
            updatedAt: { gte: new Date(profile.comebackOfferedAt.getTime() - 60_000) },
          },
        })
      : 0;

    return {
      state: profile.comebackState,
      trigger: profile.comebackTrigger,
      offeredAt: profile.comebackOfferedAt?.toISOString() ?? null,
      idleDays: idleDaysOf(profile.comebackOfferedAt ?? now, profile.lastActiveAt),
      closedCount,
      planReviewSuggested: profile.planReviewSuggestedAt !== null,
      restart: restart ? toCommitmentCard(restart, now) : null,
      recommendation: { domain: offeredDomain, reason: plan.reason },
      alternatives,
      wording: { note: OFFER_NOTE },
    };
  }

  /** "Not that one — this part of my life." */
  async choose(
    userId: string,
    domain: Domain,
    now: Date = new Date(),
  ): Promise<ComebackStatus> {
    const profile = await this.requireOffer(userId);

    const candidates = await this.loadCandidates(userId, now);
    const plan = pickForDomain(candidates, domain);

    if (!plan) {
      throw new BadRequestException({
        message: `There is no active routine to restart in ${domain}`,
        details: { reason: 'NO_RESTART_IN_DOMAIN', domain },
      });
    }

    const timeZone = safeTimeZone(profile.timezone);

    if (profile.comebackCommitmentId) {
      await this.cancelRestart(userId, profile.comebackCommitmentId);
    }

    const commitment = await this.createRestartCommitment(
      userId,
      plan,
      plan.title,
      now,
      timeZone,
    );

    await this.prisma.userProfile.update({
      where: { userId },
      data: { comebackState: 'IN_PROGRESS', comebackCommitmentId: commitment.id },
    });

    await this.audit(userId, 'comeback:choose', { domain, routineId: plan.routineId });

    return this.getStatus(userId, now);
  }

  /** "I'll do it." The UI then navigates to the full-screen Start route. */
  async start(userId: string, now: Date = new Date()): Promise<ComebackStatus> {
    await this.requireOffer(userId);

    await this.prisma.userProfile.update({
      where: { userId },
      data: { comebackState: 'IN_PROGRESS' },
    });

    await this.audit(userId, 'comeback:start', {});

    return this.getStatus(userId, now);
  }

  /**
   * "Done." The moment the whole epic exists to be able to record.
   *
   * The commitment is completed through `CommitmentActionsService` rather than
   * by a status write here, so it earns the same `completed` evidence and audit
   * row every other completion does — a comeback is a real thing the user did,
   * not a special case in the history.
   */
  async complete(
    userId: string,
    notes: string | undefined,
    now: Date = new Date(),
  ): Promise<ComebackCompletion> {
    const profile = await this.requireOffer(userId);

    const restart = profile.comebackCommitmentId
      ? await this.prisma.commitment.findFirst({
          where: { id: profile.comebackCommitmentId, userId },
        })
      : null;

    if (restart && !['COMPLETED', 'PARTIALLY_COMPLETED'].includes(restart.status)) {
      await this.actions.complete(userId, restart.id, { notes } as never);
    }

    const idleDays = idleDaysOf(profile.comebackOfferedAt ?? now, profile.lastActiveAt);

    const evidence = await this.prisma.evidence.create({
      data: {
        userId,
        commitmentId: restart?.id ?? null,
        evidenceType: 'recovery',
        source: 'APP_FLOW',
        occurredAt: now,
        qualitativeValue: JSON.stringify({
          trigger: profile.comebackTrigger,
          idleDays,
        }),
        confidence: 1,
      },
    });

    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        comebackState: 'NONE',
        comebackTrigger: null,
        comebackCommitmentId: null,
        lastActiveAt: now,
      },
    });

    await this.audit(userId, 'comeback:complete', {
      trigger: profile.comebackTrigger,
      idleDays,
      restartCommitmentId: restart?.id ?? null,
    });

    return {
      celebration: { title: CELEBRATION_TITLE, body: CELEBRATION_BODY },
      evidenceId: evidence.id,
      milestone: null,
      nextCommitment: await this.nextCommitment(userId, now),
      planReviewSuggested: profile.planReviewSuggestedAt !== null,
    };
  }

  /** "Not now." PRD §127: the user is allowed to decline being helped. */
  async dismiss(userId: string): Promise<void> {
    const profile = await this.requireOffer(userId);

    if (profile.comebackCommitmentId) {
      await this.cancelRestart(userId, profile.comebackCommitmentId);
    }

    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        comebackState: 'NONE',
        comebackTrigger: null,
        comebackCommitmentId: null,
      },
    });

    await this.audit(userId, 'comeback:dismiss', {});
  }

  // ---------------------------------------------------------------------------

  private async requireOffer(userId: string): Promise<UserProfile> {
    const profile = await this.profiles.getOrCreate(userId);

    if (profile.comebackState === 'NONE') {
      throw new ConflictException({
        message: 'There is no comeback offer open',
        details: { reason: 'NO_COMEBACK_OFFER' },
      });
    }

    return profile;
  }

  private async cancelRestart(userId: string, commitmentId: string): Promise<void> {
    const row = await this.prisma.commitment.findFirst({
      where: { id: commitmentId, userId },
      select: { id: true, status: true },
    });

    if (!row || !canTransition(row.status, 'CANCELLED')) return;

    await this.prisma.commitment.update({
      where: { id: row.id },
      data: { status: 'CANCELLED' },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'commitment:transition',
        targetType: 'commitment',
        targetId: row.id,
        meta: { from: row.status, to: 'CANCELLED', reason: 'comeback' },
      },
    });
  }

  /** PRD §57: "then schedule next realistic commitment" — or say there is none. */
  private async nextCommitment(userId: string, now: Date): Promise<CommitmentCard | null> {
    const row = await this.prisma.commitment.findFirst({
      where: {
        userId,
        status: { in: ['PLANNED', 'READY'] },
        scheduledStart: {
          gt: now,
          lte: new Date(now.getTime() + NEXT_COMMITMENT_DAYS * DAY_MS),
        },
      },
      orderBy: { scheduledStart: 'asc' },
    });

    return row ? toCommitmentCard(row, now) : null;
  }

  private async audit(
    userId: string,
    action: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'user_profile',
        targetId: userId,
        meta,
      },
    });
  }
}
