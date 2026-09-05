// =============================================================================
// The user's coaching policy (issue #49, epic E12)
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { NotificationInteractionsService } from '../interactions/notification-interactions.service';
import { assessFatigue, type FatigueAssessment } from './fatigue';
import type {
  NotificationPolicyResponse,
  PatchNotificationPolicy,
} from './dto/notification-policy.dto';
import {
  notificationPolicySchema,
  resolvePolicy,
  type ResolvedNotificationPolicy,
} from './notification-policy.schema';

/**
 * Whether PRD §61's automatic reduction is in force, and the cap that results.
 *
 * ONE implementation, shared with the decision (`policy/fatigue.ts`). The
 * settings page must not answer "has this person been ignoring us" differently
 * from the engine — a user reading `effectiveDailyCap: 2` and then receiving a
 * fourth notification would be looking at a screen that lies.
 */
export type { FatigueAssessment } from './fatigue';

@Injectable()
export class NotificationPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
    private readonly interactions: NotificationInteractionsService,
  ) {}

  /** The resolved policy, for the engine. No fatigue: that is the caller's job. */
  async resolve(userId: string): Promise<ResolvedNotificationPolicy> {
    const profile = await this.profiles.getOrCreate(userId);
    return resolvePolicy({
      timezone: profile.timezone,
      quietHoursStart: profile.quietHoursStart,
      quietHoursEnd: profile.quietHoursEnd,
      notificationPolicy: profile.notificationPolicy,
    });
  }

  /** The settings-page shape, including the live fatigue assessment. */
  async get(
    userId: string,
    now: Date = new Date(),
  ): Promise<NotificationPolicyResponse> {
    const policy = await this.resolve(userId);
    const history = await this.interactions.history(userId, {
      now,
      timeZone: policy.timezone,
    });

    return toResponse(policy, assessFatigue(history.consecutiveIgnored, policy.dailyCap));
  }

  async patch(
    userId: string,
    patch: PatchNotificationPolicy,
  ): Promise<NotificationPolicyResponse> {
    const current = await this.resolve(userId);

    const merged = notificationPolicySchema.parse({
      dailyCap: patch.dailyCap ?? current.dailyCap,
      weeklyCap: patch.weeklyCap ?? current.weeklyCap,
      perCommitmentMax: patch.perCommitmentMax ?? current.perCommitmentMax,
      mutedCategories: patch.mutedCategories ?? current.mutedCategories,
    });

    const update: Parameters<UserProfileService['update']>[1] = {
      notificationPolicy: merged as unknown as Prisma.InputJsonValue,
    };

    // Both columns move together or neither does — the same "a window needs two
    // bounds" rule `resolveQuietHours` reads back. `null` is the explicit clear.
    if (patch.quietHours !== undefined) {
      update.quietHoursStart = patch.quietHours?.start ?? null;
      update.quietHoursEnd = patch.quietHours?.end ?? null;
    }

    await this.profiles.update(userId, update);

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'notification_policy:update',
        targetType: 'user_profile',
        targetId: userId,
        // WHICH fields changed, never their values. Quiet hours describe when
        // somebody is asleep and caps describe how much coaching they can take;
        // neither is a secret, but neither belongs in a log that is read for a
        // different question ("did this account's policy change, and when?").
        meta: { changed: Object.keys(patch) },
      },
    });

    return this.get(userId);
  }
}

export function toResponse(
  policy: ResolvedNotificationPolicy,
  fatigue?: FatigueAssessment,
): NotificationPolicyResponse {
  return {
    timezone: policy.timezone,
    quietHours: policy.quietHours,
    dailyCap: policy.dailyCap,
    weeklyCap: policy.weeklyCap,
    perCommitmentMax: policy.perCommitmentMax,
    mutedCategories: policy.mutedCategories,
    fatigue: fatigue ?? { active: false, effectiveDailyCap: policy.dailyCap },
  };
}
