import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { TodayInsightCache } from '../insight/today-insight.cache';
import { localDate, safeTimeZone } from '../local-date';
import type { CheckInReader } from '../check-in-reader';
import type { CheckInFeelValue } from '../today.schema';
import type { CheckInResponseDto } from '../dto/check-in.dto';
import { ActivityTrackerService } from '../../progress/comeback/activity-tracker.service';

/**
 * The daily check-in (issue #43, epic E05).
 *
 * Implements `CheckInReader`, replacing the null implementation `TodayModule`
 * bound in #38 — which is the whole point of that seam: the scorer's input
 * arrives without the scorer learning anything about how it is stored.
 */
@Injectable()
export class CheckInService implements CheckInReader {
  private readonly logger = new Logger(CheckInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userProfile: UserProfileService,
    // The CACHE, not the insight service: depending on the service would close a
    // cycle back through TodayService → CandidateLoaderService → CHECK_IN_READER.
    private readonly insight: TodayInsightCache,
    private readonly activity: ActivityTrackerService,
  ) {}

  /** What `GET /today` reads. Never writes. */
  async readForDate(userId: string, dateLocal: string): Promise<CheckInFeelValue | null> {
    const row = await this.prisma.dailyCheckIn.findUnique({
      where: { userId_dateLocal: { userId, dateLocal } },
      select: { feel: true },
    });

    return (row?.feel as CheckInFeelValue | undefined) ?? null;
  }

  async get(userId: string, now: Date = new Date()): Promise<CheckInResponseDto | null> {
    const dateLocal = await this.localDateFor(userId, now);

    const row = await this.prisma.dailyCheckIn.findUnique({
      where: { userId_dateLocal: { userId, dateLocal } },
    });

    return row
      ? { dateLocal: row.dateLocal, feel: row.feel, updatedAt: row.updatedAt.toISOString() }
      : null;
  }

  /**
   * Record how today feels.
   *
   * UPSERT, not insert: the question is asked once a day and the answer can
   * change — a morning that started fine can become a packed afternoon. A
   * history of taps would be noise, and the unique index is what makes "one
   * answer per day" a property of the data rather than of the caller.
   */
  async upsert(
    userId: string,
    feel: CheckInFeelValue,
    now: Date = new Date(),
  ): Promise<CheckInResponseDto> {
    const dateLocal = await this.localDateFor(userId, now);

    const row = await this.write(userId, dateLocal, feel);

    // A user who just said "low energy" and still reads this morning's chirpy
    // insight would reasonably conclude nothing listened.
    this.insight.invalidate(userId);

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'today:check_in',
        targetType: 'daily_check_in',
        targetId: row.id,
        meta: { dateLocal, feel } as Prisma.InputJsonValue,
      },
    });

    // Saying how today feels is behaviour, not a page load (#112).
    this.activity.record(userId);

    return { dateLocal: row.dateLocal, feel: row.feel, updatedAt: row.updatedAt.toISOString() };
  }

  /** Two taps arriving together both attempt the insert; the index settles it. */
  private async write(userId: string, dateLocal: string, feel: CheckInFeelValue) {
    try {
      return await this.prisma.dailyCheckIn.upsert({
        where: { userId_dateLocal: { userId, dateLocal } },
        create: { userId, dateLocal, feel },
        update: { feel },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.dailyCheckIn.update({
          where: { userId_dateLocal: { userId, dateLocal } },
          data: { feel },
        });
      }
      throw error;
    }
  }

  private async localDateFor(userId: string, now: Date): Promise<string> {
    const profile = await this.userProfile.find(userId);

    return localDate(now, safeTimeZone(profile?.timezone));
  }
}
