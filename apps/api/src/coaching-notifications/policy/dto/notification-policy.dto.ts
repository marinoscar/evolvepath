// =============================================================================
// GET / PATCH /api/me/notification-policy — request and response (issue #49)
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { quietHoursTime } from '../../../user-profile/user-profile.schema';
import { COACHING_EVENT_KEY } from '../notification-policy.schema';

const quietHoursShape = z.object({ start: quietHoursTime, end: quietHoursTime });

const notificationPolicyResponseSchema = z.object({
  timezone: z.string(),
  quietHours: quietHoursShape.nullable(),
  dailyCap: z.number().int(),
  weeklyCap: z.number().int(),
  perCommitmentMax: z.number().int(),
  mutedCategories: z.array(z.string()),
  /**
   * The automatic reduction PRD §61 asks for, surfaced so the settings page can
   * explain a lower-than-configured cap rather than looking broken. Computed by
   * the SAME function the decision uses (`policy/fatigue.ts`) — a settings page
   * that disagreed with the engine would be a screen that lies.
   */
  fatigue: z.object({
    active: z.boolean(),
    effectiveDailyCap: z.number().int(),
  }),
});

export class NotificationPolicyResponseDto extends createZodDto(
  notificationPolicyResponseSchema,
) {}

export type NotificationPolicyResponse = z.infer<
  typeof notificationPolicyResponseSchema
>;

/**
 * A MERGE PATCH, not a replacement: every field is optional and an absent field
 * means "leave it alone". `quietHours: null` is the explicit clear — which is
 * why it is nullable rather than merely optional, and why the two cannot be
 * collapsed. Without the distinction there is no way to say "I no longer have
 * quiet hours" that is not also how you say "don't touch them".
 */
export const patchNotificationPolicySchema = z
  .object({
    quietHours: quietHoursShape.nullable().optional(),
    dailyCap: z.number().int().min(0).max(20).optional(),
    weeklyCap: z.number().int().min(0).max(100).optional(),
    perCommitmentMax: z.number().int().min(0).max(5).optional(),
    mutedCategories: z.array(z.string().regex(COACHING_EVENT_KEY)).max(20).optional(),
  })
  .strict();

export type PatchNotificationPolicy = z.infer<typeof patchNotificationPolicySchema>;

export class PatchNotificationPolicyDto extends createZodDto(
  patchNotificationPolicySchema,
) {}
