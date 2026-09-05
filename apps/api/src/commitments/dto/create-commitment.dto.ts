import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainSchema } from '../../path/domain.schema';

/** ISO 8601 with an offset. A local-time string has no instant to store. */
export const isoDateTime = z.string().datetime({ offset: true });

/**
 * The editable fields of a commitment, WITHOUT defaults — the same separation
 * `outcomeFieldsSchema` and `routineFieldsSchema` make, and for the same
 * reason: `.partial()` keeps a `.default()`, so a partial schema over a
 * defaulted base makes every empty PATCH look populated.
 *
 * `status` is deliberately absent from BOTH create and update. A status is
 * reached through `POST /commitments/:id/transition`, which validates the
 * matrix; allowing it here would be a second, unvalidated way to set one.
 */
export const commitmentFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime.nullish(),
  importance: z.number().int().min(1).max(5),
  commitmentType: z.string().trim().max(50).nullish(),
  /** The three sizes of one intention (PRD §57 / VISION Part III §15). */
  fullVersion: z.string().trim().max(500).nullish(),
  shortVersion: z.string().trim().max(500).nullish(),
  minimumVersion: z.string().trim().max(500).nullish(),
  userConfirmed: z.boolean(),
});

/** `scheduledEnd`, when present, must be after `scheduledStart`. */
export function refineSchedule(
  value: { scheduledStart?: string; scheduledEnd?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.scheduledStart && value.scheduledEnd) {
    if (new Date(value.scheduledEnd) <= new Date(value.scheduledStart)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduledEnd'],
        message: 'scheduledEnd must be after scheduledStart',
      });
    }
  }
}

export const createCommitmentSchema = commitmentFieldsSchema
  .extend({
    domain: domainSchema,
    importance: z.number().int().min(1).max(5).default(3),
    userConfirmed: z.boolean().default(false),
    outcomeId: z.string().uuid().nullish(),
    planVersionId: z.string().uuid().nullish(),
    routineId: z.string().uuid().nullish(),
  })
  .superRefine(refineSchedule);

export class CreateCommitmentDto extends createZodDto(createCommitmentSchema) {}
