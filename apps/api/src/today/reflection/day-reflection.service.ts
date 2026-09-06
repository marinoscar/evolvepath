import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ActivityTrackerService } from '../../progress/comeback/activity-tracker.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { localDate, localDayBounds, safeTimeZone } from '../local-date';
import type {
  CreateDayReflectionDto,
  DayReflectionResponseDto,
} from '../dto/day-reflection.dto';

/**
 * The end-of-day reflection (PRD §74, issue #43).
 *
 * REUSES E02's `reflections` table with `relatedType: 'day'` rather than adding
 * a second one. `relatedType`/`relatedId` is a soft pointer built for exactly
 * this: reflections attach to whatever the product grows next, and none of those
 * should be a migration.
 *
 * `relatedId` stays NULL: a day has no row to point at, and E02 typed that
 * column `@db.Uuid`, so a date string cannot go in it. The day is recovered from
 * `createdAt` against the user's own day bounds instead — which is also the
 * honest answer, since "which day is this reflection about" and "when was it
 * written" are the same question for an end-of-day prompt.
 *
 * `frictionTags` therefore carries the quick option and NOTHING ELSE. It is the
 * structured half of PRD §74 and what E10's weekly review groups on; smuggling a
 * date marker into it would corrupt every one of those groupings.
 */
@Injectable()
export class DayReflectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userProfile: UserProfileService,
    private readonly activity: ActivityTrackerService,
  ) {}

  async create(
    userId: string,
    dto: CreateDayReflectionDto,
    now: Date = new Date(),
  ): Promise<DayReflectionResponseDto> {
    const dateLocal = await this.localDateFor(userId, now);

    const row = await this.prisma.reflection.create({
      data: {
        userId,
        relatedType: 'day',
        relatedId: null,
        commitmentId: null,
        userText: dto.text ?? null,
        // The structured half of PRD §74: what E10's weekly review groups on.
        frictionTags: [dto.quickOption],
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'today:reflection',
        targetType: 'reflection',
        targetId: row.id,
        // The option and the day, never the note itself.
        meta: { dateLocal, quickOption: dto.quickOption } as Prisma.InputJsonValue,
      },
    });

    // A reflection is something the user did (#112).
    this.activity.record(userId);

    return {
      id: row.id,
      dateLocal,
      quickOption: dto.quickOption,
      text: row.userText,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Today's latest day reflection, or null.
   *
   * Multiple per day are allowed — a user may come back with more to say — and
   * the newest is the one the screen shows.
   */
  async getLatest(
    userId: string,
    now: Date = new Date(),
  ): Promise<DayReflectionResponseDto | null> {
    const { dateLocal, timeZone } = await this.resolveDay(userId, now);
    const { start, end } = localDayBounds(dateLocal, timeZone);

    const row = await this.prisma.reflection.findFirst({
      where: {
        userId,
        relatedType: 'day',
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) return null;

    return {
      id: row.id,
      dateLocal,
      quickOption: row.frictionTags[0] ?? 'OTHER',
      text: row.userText,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async localDateFor(userId: string, now: Date): Promise<string> {
    return (await this.resolveDay(userId, now)).dateLocal;
  }

  private async resolveDay(
    userId: string,
    now: Date,
  ): Promise<{ dateLocal: string; timeZone: string }> {
    const profile = await this.userProfile.find(userId);
    const timeZone = safeTimeZone(profile?.timezone);

    return { dateLocal: localDate(now, timeZone), timeZone };
  }
}
