import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FRICTION_ANSWER_KEYS } from '../friction-answers';

// =============================================================================
// `POST /commitments/:id/friction` (issue #116, epic E07)
// =============================================================================
//
// There is deliberately no `interventionType` on this body. Which intervention
// an answer routes to is decided server-side from `FRICTION_ANSWERS`, so a
// client cannot ask for a different one — and the coach cannot be told which
// one to claim it chose.
// =============================================================================

export const answerFrictionSchema = z
  .object({
    answer: z.enum(FRICTION_ANSWER_KEYS),
    /** The user's own words. Goes through the safety layer before the coach. */
    text: z.string().trim().max(500).nullish(),
  })
  .superRefine((value, ctx) => {
    // "Other" with nothing said is not an answer — there is nothing to route on
    // and nothing to record as an obstacle.
    if (value.answer === 'OTHER' && !value.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'TEXT_REQUIRED: tell the coach what is making it hard.',
      });
    }
  });

export class AnswerFrictionDto extends createZodDto(answerFrictionSchema) {}
