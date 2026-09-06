import { z } from 'zod';

/**
 * The part range for `GET /storage/objects/:id/upload/urls` (issue #91).
 *
 * S3 part numbers are 1-based and capped at 10,000; the 50-per-call ceiling is
 * enforced in the service, where the message can name it.
 */
export const uploadUrlsQuerySchema = z.object({
  from: z.coerce.number().int().min(1).max(10000),
  to: z.coerce.number().int().min(1).max(10000),
});

export type UploadUrlsQueryDto = z.infer<typeof uploadUrlsQuerySchema>;
