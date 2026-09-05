import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const booleanFromQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const routineQuerySchema = z.object({
  /**
   * Required. Routines are only ever meaningful inside one plan version, and a
   * cross-version listing would mix a superseded plan's behaviours with the
   * live one's.
   */
  planVersionId: z.string().uuid(),
  includeInactive: booleanFromQuery.optional().default(false),
});

export class RoutineQueryDto extends createZodDto(routineQuerySchema) {}
