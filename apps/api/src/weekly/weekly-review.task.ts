import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { safeTimeZone } from '../today/local-date';
import { defaultReviewWeek, localTimeParts } from './week-bounds';
import { WeeklyReviewService } from './weekly-review.service';

// =============================================================================
// The hourly review sweep (issue #73, epic E10)
// =============================================================================
//
// PRD §50 makes the weekly review "a core ritual on a recommended day/time
// chosen by user". Users are in different timezones, so there is no single
// instant to run at; the sweep runs every hour and asks each profile whether it
// is that user's hour.
//
// HOURLY, NOT PER MINUTE, and that is a promise the API documents: a review set
// for 17:30 is prepared in the 17:00 pass. Minute precision would mean sixty
// times the queries to move a background job by half an hour, on a screen
// nobody is watching at the moment it runs.
//
// IDEMPOTENT BY QUERY, not by lock. A user who already has a review for the
// week in question is skipped, so a slow pass overlapping the next one cannot
// produce two — and the unique `(user_id, week_start)` index is the backstop
// if it ever did.
// =============================================================================

/**
 * How many users are generated at once. Small: each generation assembles a
 * context and calls a reasoning model on that user's own key, and the sweep has
 * an hour to finish. Concurrency here buys latency nobody is waiting on and
 * spends rate limit somebody is.
 */
const BATCH_SIZE = 3;

@Injectable()
export class WeeklyReviewTask {
  private readonly logger = new Logger(WeeklyReviewTask.name);
  private readonly disabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: WeeklyReviewService,
    config: ConfigService,
  ) {
    this.disabled = config.get<boolean>('weekly.cronDisabled') ?? false;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    if (this.disabled) return;

    const now = new Date();

    const profiles = await this.prisma.userProfile.findMany({
      // Onboarding writes the plan the review is about. Reviewing a week for
      // somebody who has not finished setting one up produces a page of zeroes.
      where: { onboardingCompletedAt: { not: null } },
      select: {
        userId: true,
        timezone: true,
        weeklyReviewWeekday: true,
        weeklyReviewTime: true,
      },
    });

    const candidates = profiles.filter((profile) => {
      const zone = safeTimeZone(profile.timezone);
      const parts = localTimeParts(now, zone);

      return (
        parts.weekday === profile.weeklyReviewWeekday &&
        parts.hour === Number(profile.weeklyReviewTime.slice(0, 2))
      );
    });

    let generated = 0;
    let failed = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (profile) => {
          const zone = safeTimeZone(profile.timezone);
          const weekStart = defaultReviewWeek(now, zone);

          const existing = await this.prisma.weeklyReview.findUnique({
            where: { userId_weekStart: { userId: profile.userId, weekStart } },
            select: { status: true },
          });

          // Already done this week. A GENERATING row is the wreckage of an
          // earlier crash and is worth retrying; anything else is not.
          if (existing && existing.status !== 'GENERATING') return false;

          await this.reviews.generate(profile.userId, { weekStart, trigger: 'cron' });
          return true;
        }),
      );

      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          failed += 1;
          // One user's expired key must not stop the sweep for everybody else.
          this.logger.warn(
            `weekly review sweep failed user=${batch[index].userId}: ${result.reason}`,
          );
        } else if (result.value) {
          generated += 1;
        }
      }
    }

    if (candidates.length > 0 || generated > 0) {
      this.logger.log(
        `Weekly review sweep candidates=${candidates.length} generated=${generated} failed=${failed}`,
      );
    }
  }
}
