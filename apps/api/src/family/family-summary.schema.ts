import { z } from 'zod';

// =============================================================================
// The family review payload (issue #45, epic E08)
// =============================================================================
//
// PRD §35 permits exactly this:
//
//     Planned family commitments: 4
//     Kept: 3
//
// "But should avoid gamified judgment", and VISION §12 goes further: there is
// no relationship score and no parenting score in this product. The thing being
// measured is whether the user behaved in line with THEIR OWN stated
// intentions — never the quality of a relationship, which is not the app's to
// assess and not something the people involved consented to have assessed.
//
// -----------------------------------------------------------------------------
// WHY THE PAYLOAD IS INTEGERS AND NOTHING ELSE
// -----------------------------------------------------------------------------
//
// There is no ratio, no percentage, no streak and no grade here, and adding one
// is not a small change. A "kept %" is a score with a different name: it sorts,
// it can go down, and it invites a colour scale — which is precisely the
// gamified judgement PRD §35 rules out. A consumer that wants to divide two
// integers can; the API does not do it for them, because the API doing it is
// what would make it the product's opinion rather than the reader's arithmetic.
//
// Every schema here is `.strict()`, and `no-score.guard.spec.ts` fails the
// build if `score`, `quality`, `rating`, `grade` or `sentiment` appears in any
// family schema, DTO, or `/api/family` path of the OpenAPI document. That spec
// is the only place in this module those words are allowed to appear.
// =============================================================================

export const ritualWeekCountsSchema = z
  .object({
    /** `null` groups the ad-hoc family commitments — quick add, onboarding. */
    ritualId: z.string().uuid().nullable(),
    title: z.string(),
    /** Every row scheduled in the week, in any status except CANCELLED. */
    planned: z.number().int(),
    kept: z.number().int(),
    partial: z.number().int(),
    /** Counted in the week the commitment was ORIGINALLY due. */
    moved: z.number().int(),
    skipped: z.number().int(),
    /** E11's comeback loop sets MISSED; 0 until it ships. */
    missed: z.number().int(),
    /** PLANNED, READY or STARTED — the week is not over yet. */
    open: z.number().int(),
  })
  .strict();

export type RitualWeekCounts = z.infer<typeof ritualWeekCountsSchema>;

export const familySummaryWeekSchema = z
  .object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rituals: z.array(ritualWeekCountsSchema),
    totals: ritualWeekCountsSchema.omit({ ritualId: true, title: true }),
  })
  .strict();

export type FamilySummaryWeek = z.infer<typeof familySummaryWeekSchema>;

export const familySummarySchema = z
  .object({
    timezone: z.string(),
    /** Newest first. */
    weeks: z.array(familySummaryWeekSchema),
    coachNote: z
      .object({ text: z.string().max(280), source: z.enum(['ai', 'template']) })
      .nullable(),
  })
  .strict();

export type FamilySummary = z.infer<typeof familySummarySchema>;

/** The line ad-hoc family commitments are grouped under. */
export const UNGROUPED_TITLE = 'Other family commitments';

/** The counted fields, in render order. Used by the aggregator and its spec. */
export const COUNT_KEYS = [
  'planned',
  'kept',
  'partial',
  'moved',
  'skipped',
  'missed',
  'open',
] as const;
