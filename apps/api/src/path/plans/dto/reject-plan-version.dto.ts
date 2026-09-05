import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const rejectPlanVersionSchema = z.object({
  reason: z.string().trim().max(1000).nullish(),
});

export class RejectPlanVersionDto extends createZodDto(rejectPlanVersionSchema) {}
