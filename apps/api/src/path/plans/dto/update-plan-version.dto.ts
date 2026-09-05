import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Defaults-free by construction, so the "at least one field" rule holds. */
export const updatePlanVersionSchema = z
  .object({
    rationale: z.string().trim().min(1).max(2000).optional(),
    expectedWeeklyLoad: z.number().int().min(0).max(10080).nullish(),
    fallbackStrategy: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export class UpdatePlanVersionDto extends createZodDto(updatePlanVersionSchema) {}
