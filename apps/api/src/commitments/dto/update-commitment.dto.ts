import { createZodDto } from 'nestjs-zod';

import { commitmentFieldsSchema, refineSchedule } from './create-commitment.dto';

/**
 * `domain` and the three foreign ids are immutable, and `status` is not a
 * field — see the note on `commitmentFieldsSchema`. A client sending `status`
 * has it stripped by the schema, which then rejects the (now empty) patch.
 */
export const updateCommitmentSchema = commitmentFieldsSchema.partial().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({ code: 'custom', message: 'At least one field is required' });
    return;
  }
  refineSchedule(value, ctx);
});

export class UpdateCommitmentDto extends createZodDto(updateCommitmentSchema) {}
