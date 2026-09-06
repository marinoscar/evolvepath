import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * PRD §72's question, as a body (issue #101, epic E04).
 *
 * "How confident are you that you can do this in a difficult week?", 1–5. The
 * threshold that triggers a smaller plan lives in the service, not here — it is
 * a product rule, not a validation.
 */
export const confidenceSchema = z.object({
  score: z.number().int().min(1).max(5),
});

export class ConfidenceDto extends createZodDto(confidenceSchema) {}
