import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainModeKindSchema } from '../../domain.schema';

export const setDomainModeSchema = z.object({
  mode: domainModeKindSchema,
  reason: z.string().trim().max(500).nullish(),
});

export class SetDomainModeDto extends createZodDto(setDomainModeSchema) {}
