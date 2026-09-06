import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MediaKind, MediaPurpose } from '@prisma/client';

import { MEDIA_TARGET_TYPES } from '../media-target-types';

/**
 * How far along the pipeline this media is, in the three states a CLIENT can
 * act on.
 *
 * Deliberately not `StorageObjectStatus`. A picker showing "pending" and
 * "uploading" and "processing" as three different things asks the user to care
 * about a distinction that changes nothing they can do: in all three, the
 * answer is wait. `failed` is where they can retry, and `ready` is where they
 * can ask the coach.
 */
export const mediaProcessingStatusSchema = z.enum([
  'processing',
  'ready',
  'failed',
]);

export const mediaAttachmentResponseSchema = z.object({
  id: z.uuid(),
  storageObjectId: z.uuid(),
  kind: z.enum(MediaKind),
  purpose: z.enum(MediaPurpose),
  targetType: z.enum(MEDIA_TARGET_TYPES).nullable(),
  targetId: z.uuid().nullable(),

  processingStatus: mediaProcessingStatusSchema,
  /** The first `_processing.*_error` string, so a client can say WHY. */
  processingError: z.string().nullable(),

  /**
   * What the pipeline learned about the bytes. Every field is nullable
   * because a photo has no duration, a video has no normalized variant, and
   * neither has anything at all until processing finishes.
   */
  media: z.object({
    mimeType: z.string(),
    /** BigInt as a string — 64-bit values lose precision as JSON numbers. */
    size: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    durationMs: z.number().int().nullable(),
    frameCount: z.number().int().nullable(),
  }),

  /**
   * The coach's last structured verdict plus provenance, or null.
   *
   * Loose here on purpose: the authoritative shape is `mediaAdviceSchema`
   * (#96), which is what validates the model's output before anything is
   * stored. Restating it here would be a second declaration that drifts, and
   * this DTO would then reject data the writer considered valid.
   */
  aiSummary: z.record(z.string(), z.unknown()).nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MediaAttachmentResponse = z.infer<
  typeof mediaAttachmentResponseSchema
>;

export class MediaAttachmentResponseDto extends createZodDto(
  mediaAttachmentResponseSchema,
) {}

export const mediaPreviewVariantSchema = z.enum(['original', 'ai', 'frame']);
export type MediaPreviewVariant = z.infer<typeof mediaPreviewVariantSchema>;

export const mediaPreviewQuerySchema = z.object({
  variant: mediaPreviewVariantSchema.default('original'),
  frameIndex: z.coerce.number().int().min(0).default(0),
});

export type MediaPreviewQueryDto = z.infer<typeof mediaPreviewQuerySchema>;

export const mediaPreviewResponseSchema = z.object({
  url: z.string(),
  expiresIn: z.number().int(),
  /** Which variant was actually served — `ai` falls back to the original. */
  variant: mediaPreviewVariantSchema,
});

export class MediaPreviewResponseDto extends createZodDto(
  mediaPreviewResponseSchema,
) {}
