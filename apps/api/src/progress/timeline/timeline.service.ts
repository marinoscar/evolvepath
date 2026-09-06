import { BadRequestException, Injectable } from '@nestjs/common';

import { Trace } from '../../common/decorators/trace.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { toMilestoneView } from '../milestones/milestones.service';
import {
  afterCursor,
  buildTimeline,
  decodeCursor,
  encodeCursor,
  type TimelineEvent,
  type TimelinePlanChangeRow,
} from './timeline-builder';
import type { TimelineQuery } from './dto/timeline-query.dto';

// =============================================================================
// Loading the timeline (issue #115, epic E11)
// =============================================================================
//
// Four reads and one pure function. The reads are deliberately narrow — the
// evidence types the builder has a rule for, the misses the "returned" rule
// needs, the accepted plan changes and the milestones — because a timeline that
// loaded everything and filtered afterwards would grow a new kind of event
// every time another epic wrote an evidence row.
// =============================================================================

/** The most history one request may span. */
export const TIMELINE_MAX_RANGE_DAYS = 186;
export const TIMELINE_DEFAULT_DAYS = 28;

const DAY_MS = 24 * 3_600_000;

/** The evidence types the builder has a rule for. */
const TIMELINE_EVIDENCE_TYPES = [
  'completed',
  'partially_completed',
  'started',
  'recovery',
];

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  @Trace('progress.timeline.build')
  async getTimeline(
    userId: string,
    query: TimelineQuery,
    now: Date = new Date(),
  ): Promise<{ items: TimelineEvent[]; nextCursor: string | null }> {
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - TIMELINE_DEFAULT_DAYS * DAY_MS);

    if (to.getTime() - from.getTime() > TIMELINE_MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException({
        message: `A timeline range may span at most ${TIMELINE_MAX_RANGE_DAYS} days`,
        details: { reason: 'RANGE_TOO_LARGE', maxDays: TIMELINE_MAX_RANGE_DAYS },
      });
    }

    const rows = await this.load(userId, from, to);
    let events = buildTimeline(rows);

    if (query.domain) {
      events = events.filter((event) => event.domain === query.domain);
    }

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (!cursor) {
        throw new BadRequestException({
          message: 'Malformed timeline cursor',
          details: { reason: 'BAD_CURSOR' },
        });
      }
      events = afterCursor(events, cursor);
    }

    const limit = query.limit ?? 100;
    const page = events.slice(0, limit);

    return {
      items: page,
      nextCursor:
        events.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1])
          : null,
    };
  }

  private async load(userId: string, from: Date, to: Date) {
    const [evidence, misses, planChanges, milestones] = await Promise.all([
      this.prisma.evidence.findMany({
        where: {
          userId,
          evidenceType: { in: TIMELINE_EVIDENCE_TYPES },
          occurredAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          evidenceType: true,
          occurredAt: true,
          commitmentId: true,
          commitment: {
            select: {
              title: true,
              domain: true,
              rescheduleCount: true,
              versionUsed: true,
              commitmentType: true,
            },
          },
        },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.commitment.findMany({
        where: {
          userId,
          status: 'MISSED',
          // Deliberately wider than the window: a return on day one of the
          // range answers to a miss that happened just before it.
          scheduledStart: { gte: new Date(from.getTime() - 30 * DAY_MS), lte: to },
        },
        select: { id: true, domain: true, scheduledStart: true },
      }),
      this.prisma.auditEvent.findMany({
        where: {
          actorUserId: userId,
          action: 'plan:change_accepted',
          createdAt: { gte: from, lte: to },
        },
        select: { id: true, createdAt: true, meta: true },
      }),
      this.prisma.milestone.findMany({
        where: { userId, achievedAt: { gte: from, lte: to } },
      }),
    ]);

    return {
      evidence: evidence ?? [],
      misses: misses ?? [],
      planChanges: await this.withRationale(userId, planChanges ?? []),
      // The same view mapper the milestone cards use, so a timeline entry and a
      // card can never say two different things about one row.
      milestones: (milestones ?? []).map(toMilestoneView),
    };
  }

  /**
   * The audit row records WHICH version; the reason lives on the version.
   *
   * Joined rather than copied: PRD §80's rationale is the plan's own record of
   * why it changed, and a second copy in an audit meta would be the one that
   * went stale after an edit.
   */
  private async withRationale(
    userId: string,
    rows: Array<{ id: string; createdAt: Date; meta: unknown }>,
  ): Promise<TimelinePlanChangeRow[]> {
    const refs = rows.map((row) => {
      const meta = (row.meta ?? {}) as { planId?: string; toVersion?: number };
      return { row, planId: meta.planId, toVersion: meta.toVersion };
    });

    const wanted = refs.filter((ref) => ref.planId && ref.toVersion !== undefined);

    const versions = wanted.length
      ? await this.prisma.planVersion.findMany({
          where: {
            userId,
            OR: wanted.map((ref) => ({
              planId: ref.planId!,
              version: ref.toVersion!,
            })),
          },
          select: { planId: true, version: true, rationale: true },
        })
      : [];

    return refs.map((ref) => ({
      id: ref.row.id,
      at: ref.row.createdAt,
      toVersion: ref.toVersion ?? null,
      rationale:
        (versions ?? []).find(
          (version) =>
            version.planId === ref.planId && version.version === ref.toVersion,
        )?.rationale ?? null,
    }));
  }
}
