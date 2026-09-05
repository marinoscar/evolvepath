import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { CoachingNotificationsService } from '../coaching-notifications.service';

// =============================================================================
// The clock (issue #59, epic E12)
// =============================================================================
//
// Deliberately empty of logic — the same shape as
// `auth/tasks/token-cleanup.task.ts`. Everything this class does beyond calling
// `runOnce` is about not taking the scheduler down with it.
//
// FIVE MINUTES, not one. The candidate windows are ten to twenty-five minutes
// wide precisely so a five-minute tick cannot miss one, and a one-minute tick
// would do the same work five times for the same result. It also means a
// notification lands within five minutes of its ideal moment, which for
// "starts in about 20 minutes" is inside the rounding the copy already does.
//
// THE ERROR IS SWALLOWED. An exception escaping `handleCron` is an unhandled
// rejection inside the scheduler; the next tick would still fire, but the log
// would be a stack trace with no run summary. `runOnce` already contains its
// own failures, so this is a belt-and-braces catch for the unexpected.

@Injectable()
export class CoachingNotificationTask {
  private readonly logger = new Logger(CoachingNotificationTask.name);

  constructor(
    private readonly coaching: CoachingNotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    if (this.config.get<boolean>('coachingNotifications.enabled') === false) return;

    try {
      await this.coaching.runOnce();
    } catch (error) {
      this.logger.error(
        `coach-notify scheduled run threw: ${(error as Error).message}`,
      );
    }
  }
}
