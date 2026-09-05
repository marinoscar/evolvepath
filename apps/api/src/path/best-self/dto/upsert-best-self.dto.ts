import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const upsertBestSelfSchema = z.object({
  identityStatement: z.string().trim().max(500).nullish(),
  workIdentity: z.string().trim().max(500).nullish(),
  familyIdentity: z.string().trim().max(500).nullish(),
  healthIdentity: z.string().trim().max(500).nullish(),
  sixMonthVision: z.string().trim().max(2000).nullish(),
  motivations: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  reasons: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});

export class UpsertBestSelfDto extends createZodDto(upsertBestSelfSchema) {}
