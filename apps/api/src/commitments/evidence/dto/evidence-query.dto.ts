import { createZodDto } from 'nestjs-zod';
import { EvidenceSource } from '@prisma/client';
import { z } from 'zod';

import { domainSchema } from '../../../path/domain.schema';

/** Wider than the commitment window: evidence is what momentum is read from. */
const MAX_RANGE_DAYS = 93;

export const evidenceQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    commitmentId: z.string().uuid().optional(),
    source: z.enum(Object.values(EvidenceSource) as [string, ...string[]]).optional(),
    /** Filters through the evidence's commitment; unattached rows are excluded. */
    domain: domainSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const from = new Date(value.from);
    const to = new Date(value.to);

    if (to < from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
      return;
    }

    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `The range must not exceed ${MAX_RANGE_DAYS} days`,
      });
    }
  });

export class EvidenceQueryDto extends createZodDto(evidenceQuerySchema) {}
