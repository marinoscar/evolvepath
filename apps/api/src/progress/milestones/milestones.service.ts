import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Domain, Milestone, MilestoneKind, Prisma } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../../prisma/prisma.service';
import { safeTimeZone } from '../../today/local-date';
import { computeConsistencyRun } from '../momentum/consistency-run';
import type { WindowCommitment } from '../momentum/momentum-engine';
import { detectMilestones, type MilestoneCandidate } from './milestone-detector';
import { milestoneCopy } from './milestone-copy';

// =============================================================================
// Awarding a milestone (issue #115, epic E11)
// =============================================================================
//
// Runs after every start, every completion, every comeback and once a day in
// the sweep. That is four times more often than strictly needed, and it is the
// point: PRD §55's "first successful comeback" has to be true the moment the
// user finishes, not tomorrow morning.
//
// The cost of running it often is paid by `skipDuplicates` over the unique
// `(user_id, kind, sequence)` index — idempotency at the database rather than
// in a code path somebody could forget.
// =============================================================================

/** How far back the weekly history is counted for FIRST_FULL_WEEK. */
export const HISTORY_LOOKBACK_WEEKS = 104;
/** How many milestones `GET /progress` carries. */
export const RECENT_MILESTONES = 10;
export const MAX_MILESTONES = 50;

const DAY_MS = 24 * 3_600_000;

const metaSchema = z.record(z.string(), z.unknown());

export interface MilestoneView {
  id: string;
  kind: MilestoneKind;
  sequence: number;
  domain: Domain | null;
  achievedAt: string;
  acknowledgedAt: string | null;
  title: string;
  body: string;
  meta: Record<string, unknown>;
}

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look at everything, award what is new.
   *
   * Returns only the rows this call created, so a caller can put the fresh
   * `FIRST_COMEBACK` straight into its own response.
   */
  async evaluate(userId: string, now: Date = new Date()): Promise<Milestone[]> {
    const input = await this.loadInput(userId, now);
    const candidates = detectMilestones(input);

    if (candidates.length === 0) return [];

    const created = await this.persist(userId, candidates);

    this.logger.log(`milestones.evaluate user=${userId} new=${created.length}`);
    return created;
  }

  /**
   * The detached form. NEVER throws.
   *
   * Called from the commitment actions and the comeback completion — paths
   * where the user has already done the thing. A milestone is a nice sentence;
   * it must never be the reason a completed workout returns a 500.
   */
  afterAction(userId: string, now: Date = new Date()): void {
    void this.evaluate(userId, now).catch((error: unknown) => {
      this.logger.warn(
        `milestone evaluation failed for ${userId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    });
  }

  async list(
    userId: string,
    options: { unacknowledged?: boolean; take?: number } = {},
  ): Promise<MilestoneView[]> {
    const rows = await this.prisma.milestone.findMany({
      where: {
        userId,
        ...(options.unacknowledged ? { acknowledgedAt: null } : {}),
      },
      orderBy: { achievedAt: 'desc' },
      take: Math.min(options.take ?? MAX_MILESTONES, MAX_MILESTONES),
    });

    return (rows ?? []).map(toMilestoneView);
  }

  /**
   * What `GET /progress` shows: the recent ones, plus anything still unseen.
   *
   * The union matters — an unacknowledged milestone from six weeks ago is
   * exactly the one the user has not been shown yet, and dropping it off the
   * end of a "ten most recent" list would mean it is never celebrated at all.
   */
  async forProgress(userId: string): Promise<MilestoneView[]> {
    const [recent, unseen] = await Promise.all([
      this.list(userId, { take: RECENT_MILESTONES }),
      this.list(userId, { unacknowledged: true }),
    ]);

    const byId = new Map(recent.map((row) => [row.id, row]));
    for (const row of unseen) byId.set(row.id, row);

    return [...byId.values()].sort((a, b) => b.achievedAt.localeCompare(a.achievedAt));
  }

  /** Idempotent. A foreign id is a 404, identical to one that never existed. */
  async acknowledge(userId: string, id: string): Promise<MilestoneView> {
    const row = await this.prisma.milestone.findFirst({ where: { id, userId } });

    if (!row) throw new NotFoundException('Milestone not found');
    if (row.acknowledgedAt) return toMilestoneView(row);

    const updated = await this.prisma.milestone.update({
      where: { id },
      data: { acknowledgedAt: new Date() },
    });

    await this.audit(userId, 'milestone:acknowledge', row.id, {
      kind: row.kind,
      sequence: row.sequence,
    });

    return toMilestoneView(updated);
  }

  // ---------------------------------------------------------------------------

  private async persist(
    userId: string,
    candidates: MilestoneCandidate[],
  ): Promise<Milestone[]> {
    await this.prisma.milestone.createMany({
      data: candidates.map((candidate) => ({
        userId,
        kind: candidate.kind,
        sequence: candidate.sequence,
        domain: candidate.domain,
        achievedAt: candidate.achievedAt,
        meta: candidate.meta as Prisma.InputJsonValue,
      })),
      // The unique index does the deduplication. Two concurrent evaluations —
      // a completion and the daily sweep — must not race into two awards.
      skipDuplicates: true,
    });

    const created = await this.prisma.milestone.findMany({
      where: {
        userId,
        OR: candidates.map((candidate) => ({
          kind: candidate.kind,
          sequence: candidate.sequence,
        })),
        acknowledgedAt: null,
      },
    });

    for (const row of created ?? []) {
      await this.audit(userId, 'milestone:achieved', row.id, {
        kind: row.kind,
        sequence: row.sequence,
      });
    }

    return created ?? [];
  }

  private async loadInput(userId: string, now: Date) {
    const since = new Date(now.getTime() - HISTORY_LOOKBACK_WEEKS * 7 * DAY_MS);

    const [existing, profile, rows, workoutCompletions, comebackCompletions, postponed] =
      await Promise.all([
        this.prisma.milestone.findMany({
          where: { userId },
          select: { kind: true, sequence: true },
        }),
        this.prisma.userProfile.findUnique({
          where: { userId },
          select: { timezone: true },
        }),
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
        }),
        this.prisma.commitment.count({
          where: {
            userId,
            domain: 'HEALTH',
            status: 'COMPLETED',
            OR: [
              { commitmentType: 'workout' },
              { evidence: { some: { source: 'WORKOUT_LOG' } } },
            ],
          },
        }),
        this.prisma.evidence.count({ where: { userId, evidenceType: 'recovery' } }),
        this.prisma.evidence.findFirst({
          where: {
            userId,
            evidenceType: 'started',
            commitment: { rescheduleCount: { gte: 2 } },
          },
          orderBy: { occurredAt: 'asc' },
          select: { occurredAt: true, commitmentId: true },
        }),
      ]);

    const timeZone = safeTimeZone(profile?.timezone);
    const history: WindowCommitment[] = (rows ?? []).map((row) => ({
      id: row.id,
      domain: row.domain as WindowCommitment['domain'],
      scheduledStart: row.scheduledStart,
      status: row.status,
      rescheduleCount: row.rescheduleCount,
      fallbackUsed: row.versionUsed === 'SHORT' || row.versionUsed === 'MINIMUM',
      completedAt: row.completedAt,
      commitmentType: row.commitmentType,
    }));

    const run = computeConsistencyRun(history, now, timeZone);

    return {
      now,
      existing: existing ?? [],
      consistencyRunWeeks: run.weeks,
      // Every successful week ever, not only the current run: PRD §55's "first
      // full week" is a thing that happened, and a later bad week does not
      // un-happen it.
      successfulWeeksEver: run.weekly.filter((week) => week.success).length,
      workoutCompletions: workoutCompletions ?? 0,
      comebackCompletions: comebackCompletions ?? 0,
      startedAfterPostpone:
        postponed && postponed.commitmentId
          ? { commitmentId: postponed.commitmentId, at: postponed.occurredAt }
          : null,
      // Null until E12-06 replaces the reader; `REDUCED_REMINDERS` cannot fire.
      independence: { ratio: null as number | null, sampleSize: 0 },
    };
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'milestone', targetId, meta },
    });
  }
}

export function toMilestoneView(row: Milestone): MilestoneView {
  const meta = metaSchema.safeParse(row.meta);
  const parsed = meta.success ? meta.data : {};
  const copy = milestoneCopy(row.kind, parsed);

  return {
    id: row.id,
    kind: row.kind,
    sequence: row.sequence,
    domain: row.domain,
    achievedAt: row.achievedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    title: copy.title,
    body: copy.body,
    meta: parsed,
  };
}
