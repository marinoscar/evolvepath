import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationPolicyService } from '../policy/notification-policy.service';
import {
  aggregateNotificationMetrics,
  independenceFrom,
  type CompletionRow,
  type IndependenceMetrics,
  type InteractionRow,
  type NotificationMetrics,
  type SuppressReason,
} from './notification-metrics';

/** Statuses that count as "the user did the thing" for the independence metric. */
const DONE_STATUSES = ['COMPLETED', 'PARTIALLY_COMPLETED'] as const;

@Injectable()
export class NotificationMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: NotificationPolicyService,
  ) {}

  async get(
    userId: string,
    options: { days: number; now?: Date },
  ): Promise<NotificationMetrics> {
    const now = options.now ?? new Date();
    const from = new Date(now.getTime() - options.days * 24 * 3600_000);

    const [{ timezone }, interactions, completions] = await Promise.all([
      this.policy.resolve(userId),
      this.loadInteractions(userId, from, now),
      this.loadCompletions(userId, from, now),
    ]);

    return aggregateNotificationMetrics({
      interactions,
      completions,
      timeZone: timezone,
      window: { from, to: now },
    });
  }

  /**
   * Just the independence slice, for `GET /progress` (E11-01).
   *
   * EXPORTED SO THERE IS ONE FORMULA. The progress screen and this endpoint must
   * not be able to disagree about "how often did you do it without being asked" —
   * two implementations of PRD §65 would drift the first time somebody adjusted
   * one of them, and the number that shows on a progress card is precisely the
   * one a user would notice contradicting itself.
   */
  async independence(
    userId: string,
    options: { days: number; now?: Date },
  ): Promise<IndependenceMetrics> {
    const now = options.now ?? new Date();
    const from = new Date(now.getTime() - options.days * 24 * 3600_000);

    const [interactions, completions] = await Promise.all([
      this.loadInteractions(userId, from, now),
      this.loadCompletions(userId, from, now),
    ]);

    return independenceFrom(interactions, completions);
  }

  /** Prisma rows in, plain shapes out — the aggregator never sees a Prisma type. */
  private async loadInteractions(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<InteractionRow[]> {
    const rows = await this.prisma.notificationInteraction.findMany({
      where: { userId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        eventKey: true,
        kind: true,
        commitmentId: true,
        sentInteractionId: true,
        action: true,
        suppressReason: true,
        createdAt: true,
        meta: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      eventKey: row.eventKey,
      kind: row.kind,
      commitmentId: row.commitmentId,
      sentInteractionId: row.sentInteractionId,
      action: row.action,
      suppressReason: (row.suppressReason as SuppressReason | null) ?? null,
      createdAt: row.createdAt,
      meta:
        row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
          ? (row.meta as { leadMinutes?: number; category?: string })
          : null,
    }));
  }

  private async loadCompletions(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<CompletionRow[]> {
    const rows = await this.prisma.commitment.findMany({
      where: {
        userId,
        status: { in: [...DONE_STATUSES] },
        completedAt: { gte: from, lte: to },
      },
      select: { id: true, domain: true, completedAt: true },
    });

    return rows
      .filter((row): row is typeof row & { completedAt: Date } => row.completedAt !== null)
      .map((row) => ({
        commitmentId: row.id,
        domain: row.domain,
        completedAt: row.completedAt,
      }));
  }
}
