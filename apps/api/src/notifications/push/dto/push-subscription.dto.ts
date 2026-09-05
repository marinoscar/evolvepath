import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { pushSubscriptionKeysSchema } from '../push-subscription.schema';

/**
 * `POST /notifications/push-subscriptions` — what the browser hands back from
 * `PushSubscription.toJSON()` (issue #64, epic E12).
 *
 * `https://` is required rather than merely preferred: a push endpoint is a
 * bearer capability for a device, and sending one over plain HTTP hands it to
 * anybody on the path. There is no push service that legitimately uses `http`.
 */
export const createPushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048).startsWith('https://'),
  keys: pushSubscriptionKeysSchema,
  userAgent: z.string().max(300).optional(),
});

export class CreatePushSubscriptionDto extends createZodDto(
  createPushSubscriptionSchema,
) {}

export const deletePushSubscriptionSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});

export class DeletePushSubscriptionDto extends createZodDto(
  deletePushSubscriptionSchema,
) {}

/**
 * One device, as the settings page may see it.
 *
 * `endpointHost`, NEVER the endpoint, and never the keys. The full endpoint is
 * a capability: anyone holding it can push to that device. Showing the host is
 * enough for a human to recognise "this is my Chrome" and useless to anybody
 * who intercepts the response.
 */
const pushSubscriptionSummarySchema = z.object({
  id: z.uuid(),
  endpointHost: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

export const pushSubscriptionListSchema = z.object({
  items: z.array(pushSubscriptionSummarySchema),
});

export type PushSubscriptionSummary = z.infer<typeof pushSubscriptionSummarySchema>;

export class PushSubscriptionListDto extends createZodDto(pushSubscriptionListSchema) {}

export const pushPublicKeySchema = z.object({ publicKey: z.string().nullable() });

export class PushPublicKeyDto extends createZodDto(pushPublicKeySchema) {}
