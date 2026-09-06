import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const workSummaryQuerySchema = z.object({
  /**
   * The user's local Monday, `YYYY-MM-DD`. Absent means the current week.
   *
   * A Monday, everywhere in this product: E08's family summary and E10's weekly
   * review already fixed that, and a second week convention would make "this
   * week" two different questions on two screens.
   */
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
    .optional(),
});

export class WorkSummaryQueryDto extends createZodDto(workSummaryQuerySchema) {}
