import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { outcomeFieldsSchema } from './create-outcome.dto';

/**
 * `domain` is omitted deliberately: an outcome's domain is what files it under
 * Work, Family or Health, and moving it would orphan the plan, routines and
 * commitments that were sized for that domain's mode. Changing domain means
 * archiving one outcome and creating another.
 *
 * `state` admits only the three live states. ARCHIVED is reached through
 * `POST /outcomes/:id/archive`, which also stamps `archivedAt` — allowing it
 * here would make "archived" reachable in two ways that set different columns.
 *
 * Built over `outcomeFieldsSchema`, which carries NO defaults, so the refine
 * below actually rejects an empty body. See the note on that schema.
 */
export const updateOutcomeSchema = outcomeFieldsSchema
  .omit({ domain: true })
  .partial()
  .extend({ state: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional() })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export class UpdateOutcomeDto extends createZodDto(updateOutcomeSchema) {}
