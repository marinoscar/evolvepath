import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainSchema, outcomeStateSchema } from '../../domain.schema';

/** Query strings arrive as text; `'true'` is the only truthy spelling accepted. */
const booleanFromQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const outcomeQuerySchema = z.object({
  domain: domainSchema.optional(),
  state: outcomeStateSchema.optional(),
  includeArchived: booleanFromQuery.optional().default(false),
});

export class OutcomeQueryDto extends createZodDto(outcomeQuerySchema) {}
