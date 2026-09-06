import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MediaPurpose } from '@prisma/client';

import { MEDIA_TARGET_TYPES } from '../media-target-types';

export const createMediaAttachmentSchema = z
  .object({
    storageObjectId: z.uuid(),
    purpose: z.enum(MediaPurpose).default('GENERAL'),
    targetType: z.enum(MEDIA_TARGET_TYPES).optional(),
    targetId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    // Half a target is not a target. `targetId` alone is unqueryable — the
    // index is on the pair — and `targetType` alone claims a relationship to
    // nothing in particular.
    if (value.targetId && !value.targetType) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetType'],
        message: 'targetType is required when targetId is given',
      });
    }
    if (value.targetType && !value.targetId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'targetId is required when targetType is given',
      });
    }
  });

export type CreateMediaAttachmentDto = z.infer<
  typeof createMediaAttachmentSchema
>;

export class CreateMediaAttachmentBodyDto extends createZodDto(
  createMediaAttachmentSchema,
) {}
