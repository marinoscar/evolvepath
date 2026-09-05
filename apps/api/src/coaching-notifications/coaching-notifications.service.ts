// =============================================================================
// The run: candidates -> decide -> copy -> notify -> record (issue #59, E12)
// =============================================================================
//
// The pipeline is deliberately linear and the ORDER of its last three steps is
// the part worth reading.
//
// -----------------------------------------------------------------------------
// WHY THE SENT ROW IS WRITTEN BEFORE THE MESSAGE IS SENT
// -----------------------------------------------------------------------------
//
// The SENT row's id becomes `?n=` on every link in the notification, so it has
// to exist before the copy is written, let alone before the notification is
// dispatched. That inversion — record, then act — also buys the idempotency:
// two overlapping runs both try to insert the same `(user, event, dedupeKey)`
// and the unique index lets exactly one through. The loser gets `duplicate:
// true` and stops, having sent nothing.
//
// The alternative (send, then record what was sent) has a failure mode this one
// does not: a crash between the two produces a message the user received and
// the system has no memory of — so the next run sends it again, and the cap
// that should have stopped it cannot see it.
//
// -----------------------------------------------------------------------------
// WHY `notificationId` IS BACK-FILLED AFTERWARDS
// -----------------------------------------------------------------------------
//
// `NotificationsService.notify` is DETACHED by design (epic #109): it schedules
// the dispatch and returns before anything is rendered, so it cannot return the
// inbox row's id. Rather than change that — the detachment is what stops a slow
// SMTP server from delaying a product response — the run calls `flush()` and
// then matches the rows it just created by the `n=` in their link.
//
// -----------------------------------------------------------------------------
// ONE PROCESS, NO LOCK
// -----------------------------------------------------------------------------
//
// There is an in-process `running` flag and NO distributed lock, because this
// deployment runs one API process. The unique index means a second process
// would be correct anyway, merely wasteful — it would compute candidates and
// lose every insert. That is documented rather than solved: a real lock is a
// dependency (Redis, or advisory locks and a connection to hold them) that this
// epic does not need and should not smuggle in.

import { Injectable, Logger } from '@nestjs/common';
import type { DomainModeKind } from '@prisma/client';

import { EmailSettingsService } from '../email';
import { findEvent } from '../notifications/notification-events';
import { readNotificationPreferences, resolveChannels } from '../notifications/notification-preferences';
import type { NotificationChannel } from '../notifications/notification-events';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateScannerService } from './candidates/candidate-scanner.service';
import type { NotificationCandidate } from './candidates/notification-candidate';
import { NotificationCopywriterService } from './copy/notification-copywriter.service';
import { NotificationInteractionsService } from './interactions/notification-interactions.service';
import { decide } from './policy/notification-policy';
import { NotificationPolicyService } from './policy/notification-policy.service';
import { localDate } from '../today/local-date';

export interface CoachingRunResult {
  scanned: number;
  sent: number;
  suppressed: number;
  /** True when another run was already in progress and this one did nothing. */
  skipped: boolean;
}

/** How many copy calls may be in flight at once. */
const COPY_CONCURRENCY = 4;

@Injectable()
export class CoachingNotificationsService {
  private readonly logger = new Logger(CoachingNotificationsService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: CandidateScannerService,
    private readonly policy: NotificationPolicyService,
    private readonly interactions: NotificationInteractionsService,
    private readonly copywriter: NotificationCopywriterService,
    private readonly notifications: NotificationsService,
    private readonly emailSettings: EmailSettingsService,
  ) {}

  async runOnce(now: Date = new Date()): Promise<CoachingRunResult> {
    if (this.running) {
      this.logger.warn('coach-notify run skipped: a previous run is still in progress');
      return { scanned: 0, sent: 0, suppressed: 0, skipped: true };
    }

    this.running = true;
    const started = Date.now();
    let sent = 0;
    let suppressed = 0;
    let aiCopy = 0;
    let templateCopy = 0;
    let scanned = 0;

    try {
      const candidates = await this.scanner.scan(now);
      scanned = candidates.length;

      const emailUsable = await this.emailIsUsable();
      const decided: { candidate: NotificationCandidate; sentInteractionId: string }[] = [];

      for (const candidate of candidates) {
        const outcome = await this.decideOne(candidate, now, emailUsable);
        if (outcome === null) continue;
        if (outcome.send) {
          decided.push({ candidate, sentInteractionId: outcome.sentInteractionId });
          sent += 1;
        } else {
          suppressed += 1;
        }
      }

      const written = await this.writeCopy(decided, now);
      for (const entry of written) {
        if (entry.source === 'ai') aiCopy += 1;
        else templateCopy += 1;

        await this.notifications.notify(entry.candidate.eventKey, entry.candidate.userId, {
          ...entry.candidate.payload,
          sentInteractionId: entry.sentInteractionId,
          copy: entry.copy,
        });

        await this.recordCopySource(entry.sentInteractionId, entry.source);
      }

      // Wait for the detached dispatches so the back-fill below has rows to find.
      await this.notifications.flush();
      await this.linkInboxRows(written.map((e) => e.sentInteractionId));
    } catch (error) {
      this.logger.error(`coach-notify run failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }

    this.logger.log(
      `coach-notify run scanned=${scanned} sent=${sent} suppressed=${suppressed} ` +
        `ai=${aiCopy} template=${templateCopy} ms=${Date.now() - started}`,
    );

    return { scanned, sent, suppressed, skipped: false };
  }

  // ---------------------------------------------------------------------------

  private async decideOne(
    candidate: NotificationCandidate,
    now: Date,
    emailUsable: boolean,
  ): Promise<{ send: true; sentInteractionId: string } | { send: false } | null> {
    const event = findEvent(candidate.eventKey);
    if (!event) return null;

    // The policy first and alone: the history counts are computed in the user's
    // own local day and week, so they cannot be fetched until the timezone is
    // known.
    const policy = await this.policy.resolve(candidate.userId);

    const [enabledChannels, domainMode, history] = await Promise.all([
      this.reachableChannels(candidate, event, emailUsable),
      this.domainModeFor(candidate),
      this.interactions.history(candidate.userId, {
        now,
        timeZone: policy.timezone,
        commitmentId: candidate.commitmentId ?? null,
      }),
    ]);

    const decision = decide({
      now,
      candidate: {
        eventKey: candidate.eventKey,
        category: candidate.category,
        dueAt: candidate.dueAt,
        commitment: candidate.commitment,
      },
      policy,
      enabledChannels,
      domainMode,
      history,
    });

    const meta = {
      category: candidate.category,
      localDate: localDate(now, policy.timezone),
      ...(candidate.leadMinutes !== undefined ? { leadMinutes: candidate.leadMinutes } : {}),
    };

    if (!decision.send) {
      await this.interactions.recordSuppressed({
        userId: candidate.userId,
        eventKey: candidate.eventKey,
        commitmentId: candidate.commitmentId ?? null,
        dedupeKey: candidate.dedupeKey,
        suppressReason: decision.reason,
        meta,
      });
      this.logger.debug(
        `coach-notify suppressed user=${candidate.userId} event=${candidate.eventKey} ` +
          `reason=${decision.reason}`,
      );
      return { send: false };
    }

    const recorded = await this.interactions.recordSent({
      userId: candidate.userId,
      eventKey: candidate.eventKey,
      commitmentId: candidate.commitmentId ?? null,
      dedupeKey: candidate.dedupeKey,
      meta,
    });

    // Another run got there first. It has already sent, or is about to; sending
    // again would be the duplicate the unique index exists to prevent.
    if (recorded.duplicate) return null;

    return { send: true, sentInteractionId: recorded.id };
  }

  /**
   * The channels that are both enabled AND able to reach this user.
   *
   * `resolveChannels` is pure and knows only about preferences; it has no idea
   * whether a push subscription exists or whether email is configured. Doing
   * the subtraction here is what makes `MUTED` mean "there is nowhere to send
   * this" rather than the engine cheerfully sending into a void.
   */
  private async reachableChannels(
    candidate: NotificationCandidate,
    event: NonNullable<ReturnType<typeof findEvent>>,
    emailUsable: boolean,
  ): Promise<NotificationChannel[]> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId: candidate.userId },
      select: { value: true },
    });
    const preferences = readNotificationPreferences(settings?.value);
    const enabled = resolveChannels(event, preferences);

    return enabled.filter((channel) => (channel === 'email' ? emailUsable : true));
  }

  private async emailIsUsable(): Promise<boolean> {
    try {
      return (await this.emailSettings.get()).enabled;
    } catch {
      return false;
    }
  }

  private async domainModeFor(
    candidate: NotificationCandidate,
  ): Promise<DomainModeKind | null> {
    if (!candidate.domain) return null;
    const row = await this.prisma.domainMode.findFirst({
      where: { userId: candidate.userId, domain: candidate.domain },
      select: { mode: true },
    });
    return row?.mode ?? null;
  }

  // ---------------------------------------------------------------------------

  private async writeCopy(
    decided: { candidate: NotificationCandidate; sentInteractionId: string }[],
    _now: Date,
  ) {
    const results: {
      candidate: NotificationCandidate;
      sentInteractionId: string;
      copy: { title: string; body: string; actionLabel: string };
      source: 'ai' | 'template';
    }[] = [];

    // A small hand-rolled limiter rather than a dependency: the whole need is
    // "do not open forty provider connections because forty people have a
    // commitment at 09:00".
    for (let i = 0; i < decided.length; i += COPY_CONCURRENCY) {
      const batch = decided.slice(i, i + COPY_CONCURRENCY);
      const written = await Promise.all(
        batch.map(async ({ candidate, sentInteractionId }) => {
          const context = await this.copyContext(candidate);
          const { copy, source } = await this.copywriter.write(
            candidate.eventKey,
            candidate.category,
            candidate.payload,
            context,
          );
          return { candidate, sentInteractionId, copy, source };
        }),
      );
      results.push(...written);
    }

    return results;
  }

  private async copyContext(candidate: NotificationCandidate) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: candidate.userId },
      select: { coachingStyle: true },
    });

    // The last few things this commitment has already been told, so the model
    // can avoid saying the same sentence a third time — the specific failure
    // that makes a reminder channel feel automated.
    const priorTitles = candidate.commitmentId
      ? (
          await this.prisma.notificationInteraction.findMany({
            where: {
              userId: candidate.userId,
              commitmentId: candidate.commitmentId,
              kind: 'SENT',
              notificationId: { not: null },
            },
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { notification: { select: { title: true } } },
          })
        )
          .map((row) => row.notification?.title)
          .filter((title): title is string => typeof title === 'string')
      : [];

    return {
      userId: candidate.userId,
      coachingStyle: profile?.coachingStyle ?? 'BALANCED',
      domainMode: null,
      priorTitles,
      journeyState: null,
    };
  }

  private async recordCopySource(
    sentInteractionId: string,
    source: 'ai' | 'template',
  ): Promise<void> {
    try {
      const row = await this.prisma.notificationInteraction.findUnique({
        where: { id: sentInteractionId },
        select: { meta: true },
      });
      const meta =
        row?.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : {};

      await this.prisma.notificationInteraction.update({
        where: { id: sentInteractionId },
        data: { meta: { ...meta, copySource: source } },
      });
    } catch {
      // Bookkeeping. Losing it costs a metric, never a delivery.
    }
  }

  /**
   * Attach each SENT row to the inbox row it produced.
   *
   * Matched on the `n=<sentInteractionId>` the links carry, which is exactly
   * what that parameter is for — the attribution chain closing on itself.
   */
  private async linkInboxRows(sentInteractionIds: string[]): Promise<void> {
    for (const id of sentInteractionIds) {
      try {
        const row = await this.prisma.notification.findFirst({
          where: { link: { contains: `n=${id}` } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (row) await this.interactions.linkNotification(id, row.id);
      } catch {
        // As above: a missing link costs a metric join, not a message.
      }
    }
  }
}
