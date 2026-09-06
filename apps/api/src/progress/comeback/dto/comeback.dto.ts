import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainSchema } from '../../../path/domain.schema';

const chooseSchema = z.object({ domain: domainSchema });

export class ChooseComebackDomainDto extends createZodDto(chooseSchema) {}

const completeSchema = z.object({ notes: z.string().max(500).optional() });

export class CompleteComebackDto extends createZodDto(completeSchema) {}
