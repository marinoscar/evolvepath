import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainSchema } from '../../domain.schema';

/**
 * The editable fields of an outcome, WITHOUT defaults.
 *
 * The defaults live on `createOutcomeSchema` alone, and that separation is
 * load-bearing rather than tidy: `.partial()` does not remove a `.default()`,
 * so a partial schema built over a defaulted one parses `{}` into
 * `{ importance: 3 }` — and every "did the caller send anything?" check on the
 * parsed output then passes for an empty body. Building the update schema from
 * this defaults-free base is what makes that check mean what it says.
 */
export const outcomeFieldsSchema = z.object({
  domain: domainSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  /** 'YYYY-MM-DD'. A target date has no time of day — see `Outcome.targetDate`. */
  targetDate: z.string().date().nullish(),
  importance: z.number().int().min(1).max(5),
  motivation: z.string().trim().max(1000).nullish(),
  successDefinition: z.string().trim().max(1000).nullish(),
  userConfidence: z.number().int().min(1).max(5).nullish(),
});

export const createOutcomeSchema = outcomeFieldsSchema.extend({
  importance: z.number().int().min(1).max(5).default(3),
});

export class CreateOutcomeDto extends createZodDto(createOutcomeSchema) {}
