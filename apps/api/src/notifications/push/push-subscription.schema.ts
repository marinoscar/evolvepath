// =============================================================================
// Web push subscription keys (issue #49, consumed by E12-04)
// =============================================================================
//
// Declared here rather than in E12-04 so the column and the shape that validates
// it land in the same change. A `Json` column with no boundary schema is a
// column whose contents are whatever the first caller happened to send.

import { z } from 'zod';

/**
 * The two values a browser hands back from `PushSubscription.toJSON()`.
 *
 * They are base64url-ish strings of bounded length; the bounds are sanity
 * limits, not format checks. Validating the base64 alphabet here would reject
 * a legitimate subscription the day a push service changes its encoding, and
 * the encryption library is the component that actually has an opinion about
 * whether they are usable. NOT SECRETS OF OURS: they are useless without the
 * endpoint they belong to, which is why they sit in the same row as it.
 */
export const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
});

export type PushSubscriptionKeys = z.infer<typeof pushSubscriptionKeysSchema>;
