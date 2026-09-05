import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { refineRoutineFields, routineFieldsSchema } from './create-routine.dto';

/**
 * `planVersionId` is absent deliberately: moving a routine between versions
 * would rewrite the history of the version it left. A routine belongs to the
 * version it was created in, for the life of that version.
 *
 * Built over the defaults-free `.partial()` of the field schema — the same
 * trap as `updateOutcomeSchema`: `.partial()` does not remove a `.default()`,
 * so a base carrying defaults would make every empty PATCH look populated.
 */
export const updateRoutineSchema = routineFieldsSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'At least one field is required' });
      return;
    }
    refineRoutineFields(value, ctx);
  });

export class UpdateRoutineDto extends createZodDto(updateRoutineSchema) {}
