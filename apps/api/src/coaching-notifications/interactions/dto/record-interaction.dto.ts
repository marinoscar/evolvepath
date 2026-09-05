import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { NOTIFICATION_ACTION_KEYS } from '../../coaching-actions';

/**
 * `POST /notifications/interactions` — what the user did (issue #68, epic E12).
 *
 * TWO WAYS TO NAME THE MESSAGE, because two surfaces know different things. The
 * bell holds an inbox row and knows its `notificationId`; a deep link holds the
 * `?n=` the sender minted and knows its `sentInteractionId`. Requiring the
 * second everywhere would mean the bell parsing a link to find it, which is the
 * server's job and is done there (`parseCoachingLink`).
 *
 * `action` is required for `ACTIONED` and meaningless otherwise: "they did
 * something" with no record of WHAT is a row that cannot answer the only
 * question it exists for — which buttons are worth keeping.
 */
export const recordInteractionSchema = z
  .object({
    sentInteractionId: z.uuid().optional(),
    notificationId: z.uuid().optional(),
    kind: z.enum(['OPENED', 'ACTIONED', 'DISMISSED']),
    action: z.enum(NOTIFICATION_ACTION_KEYS).optional(),
  })
  .refine((value) => value.sentInteractionId !== undefined || value.notificationId !== undefined, {
    message: 'One of sentInteractionId or notificationId is required',
    path: ['sentInteractionId'],
  })
  .refine((value) => value.kind !== 'ACTIONED' || value.action !== undefined, {
    message: 'action is required when kind is ACTIONED',
    path: ['action'],
  });

export type RecordInteraction = z.infer<typeof recordInteractionSchema>;

export class RecordInteractionDto extends createZodDto(recordInteractionSchema) {}

const recordInteractionResponseSchema = z.object({
  id: z.uuid(),
  sentInteractionId: z.uuid().nullable(),
  kind: z.enum(['OPENED', 'ACTIONED', 'DISMISSED']),
});

export type RecordInteractionResponse = z.infer<typeof recordInteractionResponseSchema>;

export class RecordInteractionResponseDto extends createZodDto(
  recordInteractionResponseSchema,
) {}
