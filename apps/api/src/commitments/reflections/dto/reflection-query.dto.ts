import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { reflectionRelatedTypeSchema } from './create-reflection.dto';

export const reflectionQuerySchema = z.object({
  relatedType: reflectionRelatedTypeSchema.optional(),
  relatedId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export class ReflectionQueryDto extends createZodDto(reflectionQuerySchema) {}
