import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { planChangeListSchema } from '../plan-change.schema';

export const editProposalSchema = z.object({
  /**
   * The WHOLE change set, not a patch. A user editing a proposal is deciding
   * what they are agreeing to, and a partial update would make "what did I
   * approve?" depend on what was there before.
   */
  changes: planChangeListSchema,
});

export class EditProposalDto extends createZodDto(editProposalSchema) {}
