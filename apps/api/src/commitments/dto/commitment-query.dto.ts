import { createZodDto } from 'nestjs-zod';
import { CommitmentStatus } from '@prisma/client';
import { z } from 'zod';

import { domainSchema } from '../../path/domain.schema';
import { isoDateTime } from './create-commitment.dto';

/** Derived from Prisma so the two can never disagree. */
export const commitmentStatusSchema = z.enum(
  Object.values(CommitmentStatus) as [string, ...string[]],
);

/**
 * A day is one window and a month is another; 62 days is two of the longest
 * months, which covers "this month and next" — the widest thing a calendar
 * view asks for. Beyond that a client is exporting, not rendering, and should
 * page.
 */
const MAX_RANGE_DAYS = 62;

export const commitmentQuerySchema = z
  .object({
    // REQUIRED, both of them. An unbounded commitment listing grows without
    // limit for an active user and there is no screen that wants one.
    from: isoDateTime,
    to: isoDateTime,
    domain: domainSchema.optional(),
    /**
     * CSV rather than repeated keys: Fastify's query parser turns `?status=A`
     * into a string and `?status=A&status=B` into an array, so a schema that
     * accepts one shape breaks on the other. One spelling, parsed here.
     */
    status: z
      .string()
      .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
      .pipe(z.array(commitmentStatusSchema).min(1))
      .optional(),
    outcomeId: z.string().uuid().optional(),
    planVersionId: z.string().uuid().optional(),
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

export class CommitmentQueryDto extends createZodDto(commitmentQuerySchema) {}
