import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainSchema } from '../../../path/domain.schema';

/**
 * `GET /progress/timeline` — query (issue #115, epic E11).
 *
 * The range cap is a REFUSAL rather than a clamp: a client asking for two years
 * of history is asking the wrong question, and silently answering six months of
 * it would look like the user's history had a hole in it.
 */
const timelineQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  domain: domainSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export class TimelineQueryDto extends createZodDto(timelineQuerySchema) {}
