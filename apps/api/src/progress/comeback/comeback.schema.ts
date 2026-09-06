import { z } from 'zod';

import { commitmentCardSchema } from '../../commitments/commitment-card.schema';
import { domainSchema } from '../../path/domain.schema';
import { milestoneSchema } from '../progress.schema';

// =============================================================================
// The comeback contract (issue #112, epic E11)
// =============================================================================
//
// There is no list of what the user missed anywhere in this file, and that is
// the feature. PRD §109: "overdue items do not flood Today". `closedCount` is a
// single number the UI may mention in passing; the rows themselves are history
// and stay in the timeline where history belongs.
// =============================================================================

export const comebackStateSchema = z.enum(['NONE', 'OFFERED', 'IN_PROGRESS']);
export const comebackTriggerSchema = z.enum(['INACTIVITY', 'REPEATED_MISSES']);

export const restartAlternativeSchema = z.object({
  domain: domainSchema,
  title: z.string(),
  minutes: z.number().int().min(1),
});

export const comebackStatusSchema = z.object({
  state: comebackStateSchema,
  trigger: comebackTriggerSchema.nullable(),
  offeredAt: z.string().datetime().nullable(),
  /** Whole days of silence that opened the loop. */
  idleDays: z.number().int().nullable(),
  /** How many stale rows the sweep turned into history. A count, not a list. */
  closedCount: z.number().int(),
  planReviewSuggested: z.boolean(),
  restart: commitmentCardSchema.nullable(),
  recommendation: z
    .object({ domain: domainSchema, reason: z.string() })
    .nullable(),
  alternatives: z.array(restartAlternativeSchema),
  wording: z.object({ note: z.string() }),
});

export const comebackCompletionSchema = z.object({
  celebration: z.object({ title: z.string(), body: z.string() }),
  evidenceId: z.string().uuid(),
  /**
   * The `FIRST_COMEBACK` row, on the first return only (E11-03).
   *
   * In the response rather than fetched afterwards because the celebration
   * screen shows it in the same breath as "Back on Path."; a second request
   * would put the milestone on the next page load instead.
   */
  milestone: milestoneSchema.nullable(),
  nextCommitment: commitmentCardSchema.nullable(),
  planReviewSuggested: z.boolean(),
});

export type ComebackStatus = z.infer<typeof comebackStatusSchema>;
export type ComebackCompletion = z.infer<typeof comebackCompletionSchema>;

/** The Today slot. Null when there is no open loop. */
export const todayComebackSchema = z
  .object({
    state: z.enum(['OFFERED', 'IN_PROGRESS']),
    restartCommitmentId: z.string().uuid().nullable(),
    offeredAt: z.string().datetime(),
  })
  .nullable();
