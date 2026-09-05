import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import { DismissInteractionDto } from './dto/dismiss-interaction.dto';
import { NotificationInteractionsService } from './notification-interactions.service';

/** Dismissals per minute, per address. Generous: a real device sends a handful. */
const DISMISS_LIMIT_PER_MINUTE = 30;
const DISMISS_WINDOW_MS = 60_000;

/**
 * The one public route in this epic (issue #64).
 *
 * It lives in the coaching module rather than beside the push subscriptions,
 * even though it is the service worker that calls it, because it writes a
 * `notification_interactions` row and this module is that table's only writer.
 * Putting it in `NotificationsModule` would have meant that module importing
 * this one, which already imports it — a dependency cycle bought for nothing.
 * The PATH still reads `/notifications/...`, which is where a client expects it.
 */
@ApiTags('Coaching Notifications')
@Controller('notifications/interactions')
export class NotificationInteractionsController {
  /**
   * A per-process sliding window, the same shape as the AI test throttle.
   *
   * Keyed by IP because the route is public — there is no user to key on, which
   * is the whole point of it. Not a distributed limiter: one API process, and
   * the thing being limited writes at most one small row.
   */
  private readonly dismissHits = new Map<string, number[]>();

  constructor(private readonly interactions: NotificationInteractionsService) {}

  /**
   * ALWAYS 204, including for an id that does not exist. A different answer for
   * a real id would turn this into an oracle for guessing them.
   */
  @Post('dismissed')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Record that a notification was dismissed (no session required)',
    description:
      'Called by the service worker on `notificationclose`, where there is no page, no ' +
      'session and no token. Always 204, whatever the id turns out to be — a different ' +
      'answer for a real id would make this an oracle. Throttled per address.',
  })
  @ApiResponse({ status: 204, description: 'Recorded, or silently ignored' })
  async dismissed(@Body() body: DismissInteractionDto, @Ip() ip: string): Promise<void> {
    if (!this.allowDismiss(ip)) return;

    try {
      const sent = await this.interactions.findSentRowForDismissal(
        body.sentInteractionId,
      );
      if (!sent) return;

      await this.interactions.recordResponse({
        userId: sent.userId,
        kind: 'DISMISSED',
        sentInteractionId: sent.id,
      });
    } catch {
      // Silently. This route has one job and no caller who could act on an
      // error — the worker has already closed the notification.
    }
  }

  private allowDismiss(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - DISMISS_WINDOW_MS;
    const recent = (this.dismissHits.get(ip) ?? []).filter((at) => at > cutoff);

    if (recent.length >= DISMISS_LIMIT_PER_MINUTE) {
      this.dismissHits.set(ip, recent);
      return false;
    }

    recent.push(now);
    this.dismissHits.set(ip, recent);
    return true;
  }
}
