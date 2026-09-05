import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { isoDateTime } from './create-commitment.dto';
import { commitmentStatusSchema } from './commitment-query.dto';

/**
 * What the user logged, if anything.
 *
 * `source` is absent and unsettable: a client's evidence is always a USER_LOG.
 * TIMER, WORKOUT_LOG and APP_FLOW rows come from server-side flows
 * (`EvidenceService.createFromFlow`), which is why the Prisma enum has them
 * and this DTO does not.
 */
export const transitionEvidenceSchema = z.object({
  evidenceType: z.string().trim().min(1).max(50).optional(),
  quantitativeValue: z.number().finite().optional(),
  quantitativeUnit: z.string().trim().max(20).nullish(),
  qualitativeValue: z.string().trim().max(2000).nullish(),
});

export const transitionCommitmentSchema = z
  .object({
    to: commitmentStatusSchema,
    reason: z.string().trim().max(500).nullish(),
    rescheduleTo: isoDateTime.optional(),
    evidence: transitionEvidenceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const completing = value.to === 'COMPLETED' || value.to === 'PARTIALLY_COMPLETED';

    // Evidence is a record of what happened. Attaching it to a skip or a
    // cancellation would be the product asserting a fact the user never made.
    if (value.evidence && !completing) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'evidence may only accompany COMPLETED or PARTIALLY_COMPLETED',
      });
    }

    if (value.to === 'RESCHEDULED' && !value.rescheduleTo) {
      ctx.addIssue({
        code: 'custom',
        path: ['rescheduleTo'],
        message: 'rescheduleTo is required when rescheduling',
      });
    }

    if (value.rescheduleTo && value.to !== 'RESCHEDULED') {
      ctx.addIssue({
        code: 'custom',
        path: ['rescheduleTo'],
        message: 'rescheduleTo applies only to a RESCHEDULED transition',
      });
    }

    // A minute of slack, so a request in flight when the clock ticks over is
    // not rejected for being one second in the past.
    if (value.rescheduleTo) {
      const target = new Date(value.rescheduleTo).getTime();
      if (target <= Date.now() - 60_000) {
        ctx.addIssue({
          code: 'custom',
          path: ['rescheduleTo'],
          message: 'rescheduleTo must be in the future',
        });
      }
    }
  });

export class TransitionCommitmentDto extends createZodDto(transitionCommitmentSchema) {}
