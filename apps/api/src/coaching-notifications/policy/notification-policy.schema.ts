// =============================================================================
// The coaching notification policy (issue #49, epic E12)
// =============================================================================
//
// PRD §59 lists the inputs of the decision engine; this file owns the ones the
// USER controls — quiet hours, three caps, and the categories they have muted.
// Everything else the engine reads (history, domain mode, avoidance) is derived
// at decision time and belongs nowhere near a settings shape.
//
// TWO STORES, ON PURPOSE.
//
// Quiet hours are `user_profiles.quiet_hours_start/end`, declared by E04-01, and
// they stay there. The caps are `user_profiles.notification_policy` JSON. That
// split looks arbitrary until you ask who else reads each: quiet hours are a
// general "do not disturb me" fact that any future surface may want, and they
// were already columns; the caps exist only for this engine and their shape
// moves with it. Copying quiet hours into the JSON to make the shape tidy would
// create two answers to "when is this person asleep?", and the two would drift.
//
// `resolvePolicy` therefore reads BOTH and hands the engine one object, so no
// caller ever has to know where a field lives.

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { quietHoursTime } from '../../user-profile/user-profile.schema';

const logger = new Logger('NotificationPolicy');

/**
 * The values a user who has never opened the settings page gets.
 *
 * PRD §61 says the exact caps "should be experiment-controlled". There is no
 * experiment framework in this repository and this epic does not add one, so
 * these are fixed defaults a user can override — which is the honest version of
 * the same idea, and the one the acceptance criteria can actually assert.
 */
export const NOTIFICATION_POLICY_DEFAULTS = {
  dailyCap: 4,
  weeklyCap: 20,
  perCommitmentMax: 2,
  mutedCategories: [] as string[],
} as const;

/**
 * Muted categories are coaching event keys. The regex is a shape check only;
 * once the nine events are registered (E12-02) the PATCH handler additionally
 * rejects keys that are not in the registry, which is the check that actually
 * protects the user from muting nothing by typo.
 */
export const COACHING_EVENT_KEY = /^coach\.[a-z_]+$/;

export const notificationPolicySchema = z.object({
  dailyCap: z.number().int().min(0).max(20).default(NOTIFICATION_POLICY_DEFAULTS.dailyCap),
  weeklyCap: z.number().int().min(0).max(100).default(NOTIFICATION_POLICY_DEFAULTS.weeklyCap),
  perCommitmentMax: z
    .number()
    .int()
    .min(0)
    .max(5)
    .default(NOTIFICATION_POLICY_DEFAULTS.perCommitmentMax),
  mutedCategories: z.array(z.string().regex(COACHING_EVENT_KEY)).max(20).default([]),
});

export type NotificationPolicyValues = z.infer<typeof notificationPolicySchema>;

export interface QuietHours {
  start: string;
  end: string;
}

export interface ResolvedNotificationPolicy extends NotificationPolicyValues {
  timezone: string;
  quietHours: QuietHours | null;
}

export interface PolicySourceProfile {
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  notificationPolicy: unknown;
}

/**
 * TOTAL BY CONSTRUCTION. A user whose stored policy is unparseable — hand-edited
 * JSON, a column written by an older shape — must still receive coaching, under
 * the defaults. Throwing here would take the whole scheduler down for every
 * user because of one bad row, which is the failure mode PRD §120 exists to
 * prevent one layer up.
 */
export function resolvePolicy(profile: PolicySourceProfile): ResolvedNotificationPolicy {
  const parsed = notificationPolicySchema.safeParse(profile.notificationPolicy ?? {});
  if (!parsed.success) {
    logger.warn(
      'Stored notification policy did not validate; falling back to defaults. ' +
        parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
    );
  }
  const values = parsed.success
    ? parsed.data
    : notificationPolicySchema.parse({});

  return {
    ...values,
    timezone: profile.timezone,
    quietHours: resolveQuietHours(profile.quietHoursStart, profile.quietHoursEnd),
  };
}

/**
 * Both sides or nothing. A single stored bound cannot describe a window, and
 * equal bounds would describe either a zero-length window or a 24-hour one
 * depending on which reading you pick — so it describes neither and the answer
 * is "no quiet hours", which is the safe reading for the user (they still get
 * their coaching) and the only one with a single meaning.
 */
export function resolveQuietHours(
  start: string | null | undefined,
  end: string | null | undefined,
): QuietHours | null {
  if (!start || !end) return null;
  if (!quietHoursTime.safeParse(start).success) return null;
  if (!quietHoursTime.safeParse(end).success) return null;
  if (start === end) return null;
  return { start, end };
}

export { quietHoursTime };
