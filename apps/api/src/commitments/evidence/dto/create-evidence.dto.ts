import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createEvidenceSchema = z.object({
  commitmentId: z.string().uuid().nullish(),
  evidenceType: z.string().trim().min(1).max(50),
  /**
   * A LITERAL, not the Prisma enum.
   *
   * PRD §10.9: "the product should not pretend planned calendar events are
   * completion evidence". TIMER, WORKOUT_LOG and APP_FLOW mean "the system
   * observed this", and a client that could claim them could manufacture
   * observations it never made. Those sources exist for server-side flows
   * (`EvidenceService.createFromFlow`), which no route reaches.
   */
  source: z.literal('USER_LOG'),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  quantitativeValue: z.number().finite().nullish(),
  quantitativeUnit: z.string().trim().max(20).nullish(),
  qualitativeValue: z.string().trim().max(2000).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
});

export class CreateEvidenceDto extends createZodDto(createEvidenceSchema) {}
