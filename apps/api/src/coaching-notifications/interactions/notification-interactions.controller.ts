import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { DismissInteractionDto } from './dto/dismiss-interaction.dto';
import {
  RecordInteractionDto,
  RecordInteractionResponseDto,
  type RecordInteractionResponse,
} from './dto/record-interaction.dto';
import { NotificationInteractionsService } from './notification-interactions.service';

/**
 * The client's lowercase action names, mapped to the enum the column stores.
 *
 * Two spellings on purpose: a URL reads `action=start`, and a Postgres enum
 * reads `START`. Neither should have to become the other's convention.
 */
const ACTION_KINDS = {
  start: 'START',
  in: 'IN',
  move: 'MOVE',
  short: 'SHORT',
  skip: 'SKIP',
} as const;

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
   * What the user did with a notification (issue #68).
   *
   * FIRE AND FORGET FROM THE CLIENT'S POINT OF VIEW: the bell and the deep-link
   * handlers post this and navigate without waiting, because a metric must never
   * be able to delay or block the action it is measuring. That is why the
   * response is small and why every failure mode here is a status code rather
   * than something the client has to handle.
   */
  @Post()
  @Auth()
  @ApiOperation({
    summary: 'Record that a notification was opened, acted on or dismissed',
    description:
      'Name the message either by its inbox row (`notificationId`, which the bell has) or ' +
      'by the `?n=` a deep link carries (`sentInteractionId`). `action` is required for ' +
      '`ACTIONED` — "they did something" with no record of what cannot answer the only ' +
      'question the row exists for. A second `OPENED` for the same message returns the ' +
      'first: opening twice is one open, and counting re-reads would measure how often ' +
      'somebody revisits their inbox.',
  })
  @ApiResponse({ status: 201, type: RecordInteractionResponseDto })
  @ApiResponse({ status: 404, description: 'No such notification for this user' })
  async record(
    @CurrentUser('id') userId: string,
    @Body() body: RecordInteractionDto,
  ): Promise<RecordInteractionResponse> {
    const recorded = await this.interactions.recordResponse({
      userId,
      kind: body.kind,
      sentInteractionId: body.sentInteractionId ?? null,
      notificationId: body.notificationId ?? null,
      action: body.action ? ACTION_KINDS[body.action] : null,
    });

    // 404, never 403 — the same rule the rest of the product follows, and the
    // same answer an id that never existed gets.
    if (!recorded) throw new NotFoundException('Notification not found');

    return {
      id: recorded.id,
      sentInteractionId: body.sentInteractionId ?? null,
      kind: body.kind,
    };
  }

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
