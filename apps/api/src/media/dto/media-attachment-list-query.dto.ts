import { z } from 'zod';
import { MediaPurpose } from '@prisma/client';

import { MEDIA_TARGET_TYPES } from '../media-target-types';
import { MediaAttachmentResponseDto } from './media-attachment-response.dto';

export const mediaAttachmentListQuerySchema = z.object({
  targetType: z.enum(MEDIA_TARGET_TYPES).optional(),
  targetId: z.uuid().optional(),
  purpose: z.enum(MediaPurpose).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type MediaAttachmentListQueryDto = z.infer<
  typeof mediaAttachmentListQuerySchema
>;

/** Nested list shape, matching `GET /storage/objects` rather than the flat ones. */
export interface MediaAttachmentListResponseDto {
  items: MediaAttachmentResponseDto[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
