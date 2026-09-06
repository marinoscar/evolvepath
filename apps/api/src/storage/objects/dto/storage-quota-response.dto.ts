import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * What one user is holding, and what they have left (issue #87).
 *
 * Every value is a **string**: `storage_objects.size` is a `BigInt`, and a
 * 2 GiB quota expressed as a JSON number is fine right up until somebody sets
 * a larger one. `quotaBytes` and `remainingBytes` are null when
 * `STORAGE_USER_QUOTA_BYTES=0` — null rather than a very large number, so a
 * client renders "unlimited" instead of a meaningless bar.
 */
export const storageQuotaResponseSchema = z.object({
  usedBytes: z.string(),
  quotaBytes: z.string().nullable(),
  remainingBytes: z.string().nullable(),
});

export class StorageQuotaResponseDto extends createZodDto(
  storageQuotaResponseSchema,
) {}
