import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CommitmentsService } from '../../commitments/commitments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { localDate, safeTimeZone } from '../../today/local-date';
import { localTimeToInstant } from '../../weekly/week-bounds';
import { UserProfileService } from '../../user-profile/user-profile.service';
import type { CommitBehaviourDto } from '../dto/health-domain.dtos';
import { addDays } from '../weight/rolling-mean';
import {
  BEHAVIOUR_TIMES,
  findBehaviour,
  NUTRITION_BEHAVIORS,
  type NutritionBehaviour,
} from './nutrition-behaviors';

// =============================================================================
// Committing to a nutrition behaviour (issue #113, epic E09)
// =============================================================================
//
// A behaviour becomes real by becoming an ORDINARY HEALTH COMMITMENT, through
// the same `CommitmentsService.create` quick add uses. It gets the same
// validation, the same audit row, the same Today card and the same three sizes.
//
// The alternative — a `nutrition_commitments` table — would give the product a
// second kind of intention that the next best action, the weekly review and the
// momentum engine would each have to learn about separately. There is one kind
// of intention in this product, and this is it.
// =============================================================================

@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: CommitmentsService,
    private readonly profiles: UserProfileService,
  ) {}

  list(): NutritionBehaviour[] {
    return NUTRITION_BEHAVIORS;
  }

  async commit(
    userId: string,
    key: string,
    dto: CommitBehaviourDto,
  ): Promise<{ commitmentIds: string[] }> {
    const behaviour = findBehaviour(key);

    if (!behaviour) throw new NotFoundException('Behaviour not found');

    const profile = await this.profiles.find(userId);
    const timeZone = safeTimeZone(profile?.timezone);
    const startDate = dto.scheduledStart
      ? localDate(new Date(dto.scheduledStart), timeZone)
      : localDate(new Date(), timeZone);

    const commitmentIds: string[] = [];
    const repeatDays = dto.repeatDays ?? 1;

    for (let offset = 0; offset < repeatDays; offset += 1) {
      const dateLocal = addDays(startDate, offset);
      const scheduledStart = dto.scheduledStart
        ? new Date(
            new Date(dto.scheduledStart).getTime() + offset * 24 * 3600_000,
          )
        : localTimeToInstant(dateLocal, BEHAVIOUR_TIMES[behaviour.defaultTime], timeZone);

      const created = await this.commitments.create(userId, {
        domain: 'HEALTH',
        title: behaviour.title,
        scheduledStart: scheduledStart.toISOString(),
        importance: 3,
        userConfirmed: false,
        // The registry's own copy, so the Today card reads the same words the
        // user tapped rather than a paraphrase.
        commitmentType: `nutrition:${behaviour.key}`,
        fullVersion: behaviour.fullVersion.title,
        fullMinutes: behaviour.fullVersion.minutes,
        minimumVersion: behaviour.minimumVersion.title,
        minimumMinutes: behaviour.minimumVersion.minutes,
      } as never);

      commitmentIds.push(created.id);
    }

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'nutrition:commit',
        targetType: 'nutrition_behavior',
        targetId: behaviour.key,
        meta: { key: behaviour.key, days: repeatDays } as Prisma.InputJsonValue,
      },
    });

    return { commitmentIds };
  }
}
