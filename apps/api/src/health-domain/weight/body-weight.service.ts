import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { localDate, safeTimeZone } from '../../today/local-date';
import { UserProfileService } from '../../user-profile/user-profile.service';
import type {
  BodyWeightLogDto,
  PutWeightDto,
  WeightQueryDto,
  WeightTrendDto,
} from '../dto/health-domain.dtos';
import { addDays, daysBetween, rollingMean, summarise } from './rolling-mean';

// =============================================================================
// Optional weight tracking (issue #113, epic E09)
// =============================================================================
//
// PRD §47. Three rules, and all three are about restraint:
//
//   1. ONE ROW PER LOCAL DAY, upserted. Weighing yourself twice is normal;
//      two rows for one morning would make the trend depend on which one the
//      query happened to reach first.
//   2. THE VALUE IS NEVER IN THE AUDIT ROW OR THE LOG LINE. `health_weight:log`
//      records the date and nothing else. A person's body weight in an
//      operational log is a thing they did not agree to, and there is no
//      support question that needs it.
//   3. NO FUTURE DATES. Not validation pedantry: a future reading would sit at
//      the right-hand end of every chart and drag the trend towards a number
//      nobody has stood on a scale for.
// =============================================================================

/** How far back a reading may be backfilled. */
const MAX_BACKFILL_DAYS = 365;

/** The chart's default window. */
const DEFAULT_WINDOW_DAYS = 30;

@Injectable()
export class BodyWeightService {
  private readonly logger = new Logger(BodyWeightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
  ) {}

  async put(userId: string, dto: PutWeightDto): Promise<BodyWeightLogDto> {
    const today = await this.today(userId);

    if (dto.dateLocal > today) {
      throw new BadRequestException({
        code: 'WEIGHT_DATE_IN_FUTURE',
        message: 'You can only log a weight for today or a day that has already happened.',
      });
    }

    if (daysBetween(dto.dateLocal, today) > MAX_BACKFILL_DAYS) {
      throw new BadRequestException({
        code: 'WEIGHT_DATE_TOO_OLD',
        message: 'That date is more than a year ago.',
      });
    }

    const row = await this.prisma.bodyWeightLog.upsert({
      where: { userId_dateLocal: { userId, dateLocal: dto.dateLocal } },
      update: { weightKg: dto.weightKg },
      create: { userId, dateLocal: dto.dateLocal, weightKg: dto.weightKg },
    });

    // The DATE and nothing else. See rule 2 in the header.
    await this.audit(userId, 'health_weight:log', dto.dateLocal);

    return { dateLocal: row.dateLocal, weightKg: Number(row.weightKg) };
  }

  async list(userId: string, query: WeightQueryDto): Promise<WeightTrendDto> {
    const today = await this.today(userId);
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -(DEFAULT_WINDOW_DAYS - 1));

    // The window plus a run-up, so the first day's rolling mean is computed from
    // the readings before it rather than starting empty.
    const rows = await this.prisma.bodyWeightLog.findMany({
      where: { userId, dateLocal: { gte: addDays(from, -6), lte: to } },
      orderBy: { dateLocal: 'asc' },
    });

    const points = rows.map((row) => ({
      dateLocal: row.dateLocal,
      weightKg: Number(row.weightKg),
    }));

    const trend = rollingMean(points, from, to);
    const inWindow = points.filter((point) => point.dateLocal >= from);

    return {
      items: inWindow,
      trend,
      summary: summarise(trend, inWindow.length),
    };
  }

  /** Idempotent: deleting a day that was never logged is not an error. */
  async remove(userId: string, dateLocal: string): Promise<void> {
    const deleted = await this.prisma.bodyWeightLog.deleteMany({
      where: { userId, dateLocal },
    });

    if (deleted.count > 0) await this.audit(userId, 'health_weight:delete', dateLocal);
  }

  private async today(userId: string): Promise<string> {
    const profile = await this.profiles.find(userId);

    return localDate(new Date(), safeTimeZone(profile?.timezone));
  }

  private async audit(userId: string, action: string, dateLocal: string): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'body_weight_log',
        targetId: dateLocal,
        meta: { dateLocal } as Prisma.InputJsonValue,
      },
    });
  }
}
