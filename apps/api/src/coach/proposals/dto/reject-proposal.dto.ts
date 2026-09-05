import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const rejectProposalSchema = z.object({
  /** Kept and read back by the coach: "you said this wouldn't work because…". */
  reason: z.string().trim().max(300).nullish(),
});

export class RejectProposalDto extends createZodDto(rejectProposalSchema) {}
