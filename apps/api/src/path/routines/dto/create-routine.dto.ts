import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { domainSchema } from '../../domain.schema';

/** `HH:mm`, 24-hour. Used for both a TIME trigger and `preferredTime`. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:mm');

/**
 * The fields of a routine, before the cross-field rules.
 *
 * `planVersionId` is NOT here: the standalone `POST /routines` needs it in the
 * body, while routines nested inside `POST /outcomes/:id/plans` belong to a
 * version that does not exist yet. Sharing the shape and adding the id at the
 * one call site that needs it keeps the two from drifting.
 */
export const routineFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Defaults to the outcome's domain when omitted. */
  domain: domainSchema.optional(),
  triggerType: z.enum(['TIME', 'EVENT']),
  triggerValue: z.string().trim().max(200).nullish(),
  frequency: z.enum(['DAILY', 'WEEKDAYS', 'WEEKENDS', 'WEEKLY', 'CUSTOM']),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  preferredTime: timeOfDay.nullish(),
  estimatedDurationMin: z.number().int().min(1).max(480),
  minimumDurationMin: z.number().int().min(1).max(480),
  fallbackBehavior: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(999),
});

type RoutineFields = z.infer<typeof routineFieldsSchema>;

/**
 * The create-side defaults, kept OFF `routineFieldsSchema` on purpose.
 *
 * `.partial()` does not remove a `.default()`, so a partial schema built over
 * a defaulted base parses `{}` into `{ triggerType: 'TIME', frequency:
 * 'WEEKDAYS', daysOfWeek: [], sortOrder: 0 }` — and every "did the caller send
 * anything?" check then passes for an empty PATCH. Same trap as
 * `outcomeFieldsSchema`; same separation.
 */
const routineDefaults = {
  triggerType: z.enum(['TIME', 'EVENT']).default('TIME'),
  frequency: z.enum(['DAILY', 'WEEKDAYS', 'WEEKENDS', 'WEEKLY', 'CUSTOM']).default('WEEKDAYS'),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  sortOrder: z.number().int().min(0).max(999).default(0),
};

/** The field schema WITH create-side defaults applied. */
export const routineCreateFieldsSchema = routineFieldsSchema.extend(routineDefaults);

/**
 * The three rules that need more than one field to check.
 *
 * Written as a `superRefine` shared by create and update rather than duplicated:
 * an update that changes `frequency` to CUSTOM without supplying `daysOfWeek`
 * is exactly as broken as a create that does, and a rule enforced on only one
 * of the two is not a rule.
 */
export function refineRoutineFields(
  value: Partial<RoutineFields>,
  ctx: z.RefinementCtx,
): void {
  if (value.triggerType === 'TIME' && value.triggerValue != null) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.triggerValue)) {
      ctx.addIssue({
        code: 'custom',
        path: ['triggerValue'],
        message: 'A TIME trigger must be HH:mm',
      });
    }
  }

  // An EVENT trigger without its event is an implementation intention with no
  // "when" — the one thing VISION Part VI §25 says a routine must have.
  if (value.triggerType === 'EVENT' && !value.triggerValue?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['triggerValue'],
      message: 'An EVENT trigger requires the event that starts it',
    });
  }

  if (value.frequency !== undefined && value.daysOfWeek !== undefined) {
    if (value.frequency === 'CUSTOM' && value.daysOfWeek.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['daysOfWeek'],
        message: 'A CUSTOM frequency requires at least one day',
      });
    }

    if (value.frequency !== 'CUSTOM' && value.daysOfWeek.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['daysOfWeek'],
        message: 'daysOfWeek applies only to a CUSTOM frequency',
      });
    }

    if (new Set(value.daysOfWeek).size !== value.daysOfWeek.length) {
      ctx.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'Days must be unique' });
    }
  }

  // The minimum version is what keeps a streak alive on a bad day (PRD §57);
  // a minimum larger than the ideal makes the bad-day path the harder one.
  if (
    value.minimumDurationMin !== undefined &&
    value.estimatedDurationMin !== undefined &&
    value.minimumDurationMin > value.estimatedDurationMin
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['minimumDurationMin'],
      message: 'The minimum version cannot be longer than the full one',
    });
  }
}

/** A routine supplied inline when a plan is first created. */
export const createRoutineInputSchema = routineCreateFieldsSchema.superRefine(refineRoutineFields);

export const createRoutineSchema = routineCreateFieldsSchema
  .extend({ planVersionId: z.string().uuid() })
  .superRefine(refineRoutineFields);

export class CreateRoutineDto extends createZodDto(createRoutineSchema) {}
