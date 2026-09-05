// =============================================================================
// The user's coaching policy (issue #49, epic E12)
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
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
 * What the engine needs on top of the stored policy: whether the automatic
 * reduction of PRD §61 is currently in force, and the cap that results.
 *
 * E12-01 answers this inertly on purpose. Fatigue is a function of the
 * interaction history the decision engine also reads, and computing it here
 * would mean two implementations of "has this person been ignoring us" — one in
 * the settings response and one in the decision. E12-03 supplies the real one
 * through this interface, and the response shape does not change when it does.
 */
export interface FatigueAssessment {
  active: boolean;
  effectiveDailyCap: number;
}

@Injectable()
export class NotificationPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
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

  /** The settings-page shape. */
  async get(
    userId: string,
    fatigue?: FatigueAssessment,
  ): Promise<NotificationPolicyResponse> {
    const policy = await this.resolve(userId);
    return toResponse(policy, fatigue);
  }

  async patch(
    userId: string,
    patch: PatchNotificationPolicy,
    fatigue?: FatigueAssessment,
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

    return this.get(userId, fatigue);
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
