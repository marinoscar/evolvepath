import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainSchema } from '../../path/domain.schema';

/** ISO 8601 with an offset. A local-time string has no instant to store. */
export const isoDateTime = z.string().datetime({ offset: true });

/** Minutes for one size of an intention. Eight hours is not a commitment. */
const versionMinutes = z.number().int().min(1).max(480);

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
  /**
   * The three sizes of one intention (PRD §57 / VISION Part III §15).
   *
   * The `*Version` field is the TITLE and the `*Minutes` field is how long that
   * size takes. Minutes are separate rather than a nested object because the
   * next-best-action sizer reads them on every candidate on every Today request
   * (#40), and because `.partial()` over a flat shape is what makes PATCH able
   * to change one of the six without restating the others.
   */
  fullVersion: z.string().trim().max(500).nullish(),
  shortVersion: z.string().trim().max(500).nullish(),
  minimumVersion: z.string().trim().max(500).nullish(),
  fullMinutes: versionMinutes.nullish(),
  shortMinutes: versionMinutes.nullish(),
  minimumMinutes: versionMinutes.nullish(),
  userConfirmed: z.boolean(),
});

/**
 * The ordering the three sizes have to satisfy when they are declared together:
 * `minimum <= short <= full`. A "short version" that took longer than the full
 * one is not a smaller option, it is a typo — and the sizer would happily offer
 * it to someone who just said they were depleted.
 *
 * Only compares the pairs actually present, so a PATCH that touches one size
 * cannot be rejected for a size it never mentioned.
 */
export function refineVersionMinutes(
  value: {
    fullMinutes?: number | null;
    shortMinutes?: number | null;
    minimumMinutes?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  const { fullMinutes, shortMinutes, minimumMinutes } = value;

  if (shortMinutes != null && fullMinutes != null && shortMinutes > fullMinutes) {
    ctx.addIssue({
      code: 'custom',
      path: ['shortMinutes'],
      message: 'The short version cannot take longer than the full one',
    });
  }

  if (minimumMinutes != null && shortMinutes != null && minimumMinutes > shortMinutes) {
    ctx.addIssue({
      code: 'custom',
      path: ['minimumMinutes'],
      message: 'The minimum version cannot take longer than the short one',
    });
  }

  if (minimumMinutes != null && shortMinutes == null && fullMinutes != null && minimumMinutes > fullMinutes) {
    ctx.addIssue({
      code: 'custom',
      path: ['minimumMinutes'],
      message: 'The minimum version cannot take longer than the full one',
    });
  }
}

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
  .superRefine(refineSchedule)
  .superRefine(refineVersionMinutes);

export class CreateCommitmentDto extends createZodDto(createCommitmentSchema) {}
