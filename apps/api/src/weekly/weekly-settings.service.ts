import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { safeTimeZone } from '../today/local-date';
import { UserProfileService } from '../user-profile/user-profile.service';
import { localTimeParts, localTimeToInstant } from './week-bounds';
import type { UpdateWeeklySettingsDto, WeeklySettingsDto } from './dto/weekly-review.dtos';
import { localDate } from '../today/local-date';

/**
 * When the weekly review is prepared (PRD §50, issue #73).
 *
 * Two columns on `user_profiles` rather than a settings key: the hourly sweep
 * queries on them, and `user_settings` is a JSON document the API deliberately
 * never interprets.
 */
@Injectable()
export class WeeklySettingsService {
  private readonly logger = new Logger(WeeklySettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
  ) {}

  async get(userId: string): Promise<WeeklySettingsDto> {
    const profile = await this.profiles.getOrCreate(userId);
    const timezone = safeTimeZone(profile.timezone);

    return {
      weeklyReviewWeekday: profile.weeklyReviewWeekday,
      weeklyReviewTime: profile.weeklyReviewTime,
      timezone,
      nextReviewAt: this.nextReviewAt(
        new Date(),
        timezone,
        profile.weeklyReviewWeekday,
        profile.weeklyReviewTime,
      ).toISOString(),
    };
  }

  async update(userId: string, dto: UpdateWeeklySettingsDto): Promise<WeeklySettingsDto> {
    const profile = await this.profiles.getOrCreate(userId);
    // Copied out before the write, not read off the row afterwards: `from` is
    // the whole value of this audit line.
    const from = {
      weeklyReviewWeekday: profile.weeklyReviewWeekday,
      weeklyReviewTime: profile.weeklyReviewTime,
    };

    await this.profiles.update(userId, {
      weeklyReviewWeekday: dto.weeklyReviewWeekday,
      weeklyReviewTime: dto.weeklyReviewTime,
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'weekly_settings:update',
        targetType: 'user_profile',
        targetId: profile.id,
        meta: {
          from,
          to: {
            weeklyReviewWeekday: dto.weeklyReviewWeekday,
            weeklyReviewTime: dto.weeklyReviewTime,
          },
        } as Prisma.InputJsonValue,
      },
    });

    return this.get(userId);
  }

  /**
   * The next local occurrence of that weekday and time, as an instant.
   *
   * Resolved through `localTimeToInstant` so the answer is right across a DST
   * boundary — "next Friday 16:00" is a wall clock, and adding 7 × 24 hours to
   * the last one would drift by an hour twice a year.
   */
  nextReviewAt(now: Date, timeZone: string, weekday: number, time: string): Date {
    const zone = safeTimeZone(timeZone);
    const parts = localTimeParts(now, zone);
    const today = localDate(now, zone);

    let daysAhead = (weekday - parts.weekday + 7) % 7;

    // Today, but the hour has already gone by: the next one is a week out.
    // Compared on the hour rather than the minute because the sweep is hourly.
    if (daysAhead === 0 && parts.hour >= Number(time.slice(0, 2))) daysAhead = 7;

    return localTimeToInstant(shiftDate(today, daysAhead), time, zone);
  }
}

function shiftDate(dateLocal: string, days: number): string {
  const [year, month, day] = dateLocal.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day) + days * 24 * 3600_000)
    .toISOString()
    .slice(0, 10);
}
