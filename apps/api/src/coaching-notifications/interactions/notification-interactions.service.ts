// =============================================================================
// The only writer of `notification_interactions` (issue #49, epic E12)
// =============================================================================
//
// E12-03 (the engine), E12-04 (push), E12-05 (the web) and E12-06 (metrics) all
// need rows in this table, and every one of them goes through this service
// rather than Prisma. That is the same "one writer per table" rule E04-01 set
// for `user_profiles`, applied here for a sharper reason: three of the five row
// kinds are only meaningful RELATIVE to a SENT row (an OPENED copies its event
// key and commitment from it, an ACTIONED must not exist without one). Spread
// that across four call sites and the invariant is four implementations.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationActionKind,
  NotificationInteractionKind,
  NotificationSuppressReason,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { localDate, localDayBounds, localWeekBounds } from '../../today/local-date';

/** How long a message may sit unanswered before it counts as ignored. */
export const IGNORED_AFTER_MS = 2 * 60 * 60 * 1_000;
/** How far back `consecutiveIgnored` looks. Fatigue is about now, not history. */
export const FATIGUE_WINDOW_DAYS = 7;

export interface RecordSentInput {
  userId: string;
  eventKey: string;
  commitmentId?: string | null;
  dedupeKey: string;
  meta?: Prisma.InputJsonValue;
}

export interface RecordSuppressedInput extends RecordSentInput {
  suppressReason: NotificationSuppressReason;
}

export interface RecordedInteraction {
  id: string;
  /** True when the unique index already held a decision for this candidate. */
  duplicate: boolean;
}

export interface RecordResponseInput {
  userId: string;
  kind:
    | typeof NotificationInteractionKind.OPENED
    | typeof NotificationInteractionKind.ACTIONED
    | typeof NotificationInteractionKind.DISMISSED;
  sentInteractionId?: string | null;
  notificationId?: string | null;
  action?: NotificationActionKind | null;
}

export interface InteractionHistory {
  sentToday: number;
  sentThisWeek: number;
  sentForCommitment: number;
  consecutiveIgnored: number;
  lastActionedAt: Date | null;
}

@Injectable()
export class NotificationInteractionsService {
  private readonly logger = new Logger(NotificationInteractionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordSent(input: RecordSentInput): Promise<RecordedInteraction> {
    return this.recordDecision({ ...input, kind: NotificationInteractionKind.SENT });
  }

  async recordSuppressed(input: RecordSuppressedInput): Promise<RecordedInteraction> {
    return this.recordDecision({
      ...input,
      kind: NotificationInteractionKind.SUPPRESSED,
    });
  }

  /**
   * A decision — SENT or SUPPRESSED — is unique per `(user, event, dedupeKey)`.
   *
   * The race this catches is real and routine, not theoretical: the scheduler
   * scans a window every few minutes and a manual run can overlap a cron tick.
   * A pre-read `hasDecision` check would leave the window open between the read
   * and the write, so the unique index is the actual guard and P2002 is the
   * expected outcome, not an error.
   */
  private async recordDecision(
    input: RecordSentInput & {
      kind: NotificationInteractionKind;
      suppressReason?: NotificationSuppressReason;
    },
  ): Promise<RecordedInteraction> {
    try {
      const row = await this.prisma.notificationInteraction.create({
        data: {
          userId: input.userId,
          eventKey: input.eventKey,
          kind: input.kind,
          commitmentId: input.commitmentId ?? null,
          suppressReason: input.suppressReason ?? null,
          dedupeKey: input.dedupeKey,
          meta: input.meta,
        },
        select: { id: true },
      });
      return { id: row.id, duplicate: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.notificationInteraction.findFirst({
          where: {
            userId: input.userId,
            eventKey: input.eventKey,
            dedupeKey: input.dedupeKey,
          },
          select: { id: true },
        });
        if (existing) return { id: existing.id, duplicate: true };
      }
      throw error;
    }
  }

  /**
   * Record what the user did. The SENT row is the anchor: `eventKey` and
   * `commitmentId` are COPIED from it rather than passed in, so a client cannot
   * mislabel a response, and a metric never has to join to find out what a
   * response was about.
   */
  async recordResponse(input: RecordResponseInput): Promise<{ id: string } | null> {
    const sent = await this.resolveSentRow(input);
    if (!sent) return null;

    if (sent.userId !== input.userId) {
      // 404, never 403 — the same rule the rest of the product follows. Telling
      // a caller that an id exists but is not theirs is itself a disclosure.
      throw new NotFoundException('Notification interaction not found');
    }

    if (input.kind === NotificationInteractionKind.OPENED) {
      const alreadyOpened = await this.prisma.notificationInteraction.findFirst({
        where: {
          sentInteractionId: sent.id,
          kind: NotificationInteractionKind.OPENED,
        },
        select: { id: true },
      });
      // Opening twice is one open. Counting re-reads would make the open rate
      // depend on how often a user revisits their inbox, which measures nothing.
      if (alreadyOpened) return alreadyOpened;
    }

    const row = await this.prisma.notificationInteraction.create({
      data: {
        userId: input.userId,
        eventKey: sent.eventKey,
        kind: input.kind,
        commitmentId: sent.commitmentId,
        notificationId: input.notificationId ?? sent.notificationId,
        sentInteractionId: sent.id,
        action: input.action ?? null,
      },
      select: { id: true },
    });
    return row;
  }

  private async resolveSentRow(input: RecordResponseInput): Promise<{
    id: string;
    userId: string;
    eventKey: string;
    commitmentId: string | null;
    notificationId: string | null;
  } | null> {
    if (input.sentInteractionId) {
      return this.prisma.notificationInteraction.findUnique({
        where: { id: input.sentInteractionId },
        select: {
          id: true,
          userId: true,
          eventKey: true,
          commitmentId: true,
          notificationId: true,
        },
      });
    }
    if (input.notificationId) {
      // The bell knows the inbox row, not the decision. `linkNotification` wrote
      // the association when the channel delivered, so this resolves without the
      // client ever having to carry the interaction id.
      return this.prisma.notificationInteraction.findFirst({
        where: {
          notificationId: input.notificationId,
          kind: NotificationInteractionKind.SENT,
        },
        select: {
          id: true,
          userId: true,
          eventKey: true,
          commitmentId: true,
          notificationId: true,
        },
      });
    }
    return null;
  }

  /**
   * Attach the channel's own row ids to a decision after the fact.
   *
   * The ordering is unavoidable: `notify()` is detached and the browser channel
   * writes the inbox row inside it, so the SENT row necessarily exists first and
   * learns the notification id afterwards.
   */
  async linkNotification(
    sentInteractionId: string,
    notificationId: string | null,
    deliveryId?: string | null,
  ): Promise<void> {
    try {
      await this.prisma.notificationInteraction.update({
        where: { id: sentInteractionId },
        data: { notificationId, deliveryId: deliveryId ?? undefined },
      });
    } catch (error) {
      // Linking is bookkeeping. Losing it costs a metric join, not a delivery,
      // and must never take down the dispatch that is already in flight.
      this.logger.warn(
        `Could not link interaction ${sentInteractionId} to its notification row.`,
      );
    }
  }

  async hasDecision(
    userId: string,
    eventKey: string,
    dedupeKey: string,
  ): Promise<boolean> {
    const existing = await this.prisma.notificationInteraction.findFirst({
      where: { userId, eventKey, dedupeKey },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * Everything the caps and the fatigue rule need, in one read per question.
   *
   * The day and week bounds are the USER'S, not UTC. A daily cap computed in UTC
   * would reset in the middle of the evening for anyone west of Greenwich, which
   * is exactly when the coaching messages cluster.
   */
  async history(
    userId: string,
    options: { now: Date; timeZone: string; commitmentId?: string | null },
  ): Promise<InteractionHistory> {
    const dateLocal = localDate(options.now, options.timeZone);
    const day = localDayBounds(dateLocal, options.timeZone);
    const week = localWeekBounds(dateLocal, options.timeZone);

    const [sentToday, sentThisWeek, sentForCommitment, lastActioned] =
      await Promise.all([
        this.prisma.notificationInteraction.count({
          where: {
            userId,
            kind: NotificationInteractionKind.SENT,
            createdAt: { gte: day.start, lt: day.end },
          },
        }),
        this.prisma.notificationInteraction.count({
          where: {
            userId,
            kind: NotificationInteractionKind.SENT,
            createdAt: { gte: week.start, lt: week.end },
          },
        }),
        options.commitmentId
          ? this.prisma.notificationInteraction.count({
              where: {
                userId,
                commitmentId: options.commitmentId,
                kind: NotificationInteractionKind.SENT,
              },
            })
          : Promise.resolve(0),
        this.prisma.notificationInteraction.findFirst({
          where: { userId, kind: NotificationInteractionKind.ACTIONED },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

    return {
      sentToday,
      sentThisWeek,
      sentForCommitment,
      lastActionedAt: lastActioned?.createdAt ?? null,
      consecutiveIgnored: await this.countConsecutiveIgnored(
        userId,
        options.now,
        lastActioned?.createdAt ?? null,
      ),
    };
  }

  /**
   * SENT rows newer than the last ACTIONED, older than two hours, with no
   * response of any kind.
   *
   * The two-hour grace is what separates "ignored" from "hasn't looked yet": a
   * reminder fired ten minutes ago has not been ignored, it is simply pending,
   * and counting it would make fatigue trip on a burst rather than on a pattern.
   * DISMISSED counts as ignored on purpose — an explicit dismissal is a stronger
   * signal that the message was unwanted than silence is.
   */
  private async countConsecutiveIgnored(
    userId: string,
    now: Date,
    lastActionedAt: Date | null,
  ): Promise<number> {
    const windowStart = new Date(
      now.getTime() - FATIGUE_WINDOW_DAYS * 24 * 3600_000,
    );
    const since =
      lastActionedAt && lastActionedAt > windowStart ? lastActionedAt : windowStart;

    const candidates = await this.prisma.notificationInteraction.findMany({
      where: {
        userId,
        kind: NotificationInteractionKind.SENT,
        createdAt: { gt: since, lte: new Date(now.getTime() - IGNORED_AFTER_MS) },
      },
      select: {
        id: true,
        responses: {
          where: {
            kind: {
              in: [
                NotificationInteractionKind.OPENED,
                NotificationInteractionKind.ACTIONED,
              ],
            },
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    return candidates.filter((row) => row.responses.length === 0).length;
  }
}
