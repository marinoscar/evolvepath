// =============================================================================
// Web push (issue #64, epic E12)
// =============================================================================
//
// PRD §123: "behaviour intervention often occurs near the moment of action" —
// and that moment is rarely one with the app open. The browser channel reaches
// an open tab over SSE and otherwise leaves an inbox row for the next visit; a
// "starts in 20 minutes" cue that waits for the next visit is not a cue.
//
// -----------------------------------------------------------------------------
// THE FALLBACK IS `resolveTo` RETURNING NULL, AND THAT IS ALL
// -----------------------------------------------------------------------------
//
// A user with no subscription, or a deployment with no VAPID keys, gets `null`
// here. The dispatcher already handles that: it logs, skips, and writes NO
// delivery row — while the browser channel, running independently for the same
// event, still writes the inbox row and pushes it down the SSE stream. So the
// fallback needs no branch inside this file, and adding one would create a
// second answer to "was this delivered?".
//
// -----------------------------------------------------------------------------
// ONE TEMPLATE, TWO TRANSPORTS
// -----------------------------------------------------------------------------
//
// The payload is rendered through `renderBrowserContent` — the same function the
// inbox row uses. A user holding a phone and looking at an open tab must not
// read two different sentences about the same moment, and the way to guarantee
// that is not "keep two templates in sync" but "there is one".
//
// -----------------------------------------------------------------------------
// PARTIAL SUCCESS IS SUCCESS
// -----------------------------------------------------------------------------
//
// Someone with a laptop and a phone has two subscriptions. If the laptop's
// endpoint is dead and the phone's works, the user was notified — reporting a
// delivery failure would be false, and would make the failure metric measure
// stale browser profiles rather than undelivered messages.

import { Injectable, Logger } from '@nestjs/common';

import { actionsFor } from '../../coaching-notifications/coaching-actions';
import { categoryFor } from '../../coaching-notifications/coaching-events';
import { PrismaService } from '../../prisma/prisma.service';
import { describeThrown } from '../describe-thrown';
import type { NotificationChannel } from '../notification-events';
import type {
  ChannelDeliveryResult,
  NotificationChannelSender,
  NotificationDispatchContext,
  NotificationRecipient,
} from '../notification.types';
import { pushSubscriptionKeysSchema } from '../push/push-subscription.schema';
import { WebPushProvider } from '../push/web-push.provider';
import { renderBrowserContent, sanitizeLink } from './browser-notification.channel';

/**
 * How long a push service should hold an undelivered message.
 *
 * Thirty minutes, not the protocol's days. Every coaching message is about a
 * moment: a phone that comes back online tomorrow morning and buzzes "Upper A
 * starts in 20 minutes" is worse than one that never buzzes at all, because the
 * user cannot tell from the notification that it is stale.
 */
export const PUSH_TTL_SECONDS = 1_800;

/** Browsers render at most two action buttons; the rest are silently dropped. */
export const MAX_PUSH_ACTIONS = 2;

/** The categories that are worth waking a sleeping device for. */
const URGENT_CATEGORIES = new Set(['N2', 'N5']);

@Injectable()
export class PushNotificationChannel implements NotificationChannelSender {
  readonly channel: NotificationChannel = 'push';
  private readonly logger = new Logger(PushNotificationChannel.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webPush: WebPushProvider,
  ) {}

  /**
   * Synchronous by contract, so the "does this user have a device?" question
   * cannot be asked here — the sender interface returns a string, not a promise.
   * The userId is returned whenever push is configured at all, and `deliver`
   * answers "no subscriptions" as an ordinary failure with a clear message.
   */
  resolveTo(recipient: NotificationRecipient): string | null {
    if (!this.webPush.isConfigured()) return null;
    return recipient.userId;
  }

  async deliver(
    context: NotificationDispatchContext,
    to: string,
  ): Promise<ChannelDeliveryResult> {
    const rendered = renderBrowserContent(context);
    if (!rendered.ok) return { success: false, error: rendered.error };

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: to },
      select: { id: true, endpoint: true, keys: true },
    });

    if (subscriptions.length === 0) {
      return { success: false, error: 'The user has no push subscriptions.' };
    }

    const payload = this.buildPayload(context, rendered.content);
    const options = {
      TTL: PUSH_TTL_SECONDS,
      urgency: (URGENT_CATEGORIES.has(categoryFor(context.event.key) ?? '')
        ? 'high'
        : 'normal') as 'high' | 'normal',
    };

    let delivered = 0;
    const errors: string[] = [];

    for (const subscription of subscriptions) {
      const keys = pushSubscriptionKeysSchema.safeParse(subscription.keys);
      if (!keys.success) {
        // A row whose keys cannot be parsed can never be delivered to. Deleting
        // it is the same treatment a 410 gets, for the same reason.
        errors.push('a subscription had unusable keys');
        await this.forget(subscription.id, subscription.endpoint, 'unusable keys');
        continue;
      }

      const result = await this.webPush.send(
        { endpoint: subscription.endpoint, keys: keys.data },
        payload,
        options,
      );

      if (result.ok) {
        delivered += 1;
        await this.touch(subscription.id);
        continue;
      }

      if (result.gone) {
        await this.forget(
          subscription.id,
          subscription.endpoint,
          `gone (${result.statusCode})`,
        );
        continue;
      }

      errors.push(result.error ?? `status ${result.statusCode ?? 'unknown'}`);
    }

    this.logger.log(
      `Pushed '${context.event.key}' to user ${to}: ` +
        `${delivered}/${subscriptions.length} device(s).`,
    );

    if (delivered === 0) {
      return {
        success: false,
        error:
          errors.length > 0
            ? `No device accepted the push: ${errors.join('; ')}`
            : 'Every subscription for this user is gone.',
      };
    }

    return { success: true, messageId: `${delivered}/${subscriptions.length}` };
  }

  /**
   * What the service worker receives.
   *
   * Deliberately small — a push payload has a hard ceiling of about 4 KB after
   * encryption, and it carries no user data beyond what the notification says.
   * `tag` is the SENT row's id so a re-send about the same moment REPLACES the
   * previous banner rather than stacking beside it.
   */
  private buildPayload(
    context: NotificationDispatchContext,
    content: { title: string; body: string; link?: string; actions?: unknown },
  ): string {
    const data = context.data as { sentInteractionId?: unknown } | null | undefined;
    const sentInteractionId =
      typeof data?.sentInteractionId === 'string' ? data.sentInteractionId : null;

    const actions = actionsFor(context.event.key, context.data)
      .slice(0, MAX_PUSH_ACTIONS)
      .map((action) => ({
        action: action.action,
        label: action.label,
        link: action.link,
      }));

    return JSON.stringify({
      title: content.title,
      body: content.body,
      link: sanitizeLink(content.link ?? undefined),
      actions,
      eventKey: context.event.key,
      sentInteractionId,
      tag: sentInteractionId ?? context.event.key,
    });
  }

  private async touch(id: string): Promise<void> {
    try {
      await this.prisma.pushSubscription.update({
        where: { id },
        data: { lastSeenAt: new Date() },
      });
    } catch {
      // Bookkeeping: `lastSeenAt` tells an operator which devices are live. A
      // failure to update it must not fail a push that was delivered.
    }
  }

  private async forget(id: string, endpoint: string, reason: string): Promise<void> {
    try {
      await this.prisma.pushSubscription.delete({ where: { id } });
      // The HOST only. A full endpoint is a bearer capability for that device —
      // anyone holding it can push to it — so it never reaches a log line.
      this.logger.log(`push subscription removed host=${hostOf(endpoint)} reason=${reason}`);
    } catch (error) {
      this.logger.debug(
        `Could not remove a dead push subscription: ${describeThrown(error)}`,
      );
    }
  }
}

/** The host of an endpoint, for logs and for the subscription list response. */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}
