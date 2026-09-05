import { z } from 'zod';

import { planChangeSchema } from '../coach/proposals/plan-change.schema';

// =============================================================================
// The weekly loop's JSON boundary (issue #65, epic E10)
// =============================================================================
//
// `weekly_reviews.aggregates`, `weekly_reviews.ai_summary`,
// `weekly_plans.constraints`, `weekly_plans.domain_modes` and
// `weekly_plans.proposal` are `jsonb`. The database will accept anything at all
// in them, so this file is the only thing standing between a typo in a service
// and a screen that renders `undefined / undefined`.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
//   1. `planChangeSchema` is IMPORTED, never redeclared. The reviewer's
//      proposed changes travel through E06-04's mutation protocol unchanged;
//      a second copy of the change vocabulary here would drift the moment one
//      of the two grew an op, and the proposal that failed to validate would
//      be the coach's, in production.
//
//   2. Dates are `'YYYY-MM-DD'` strings and times are `'HH:mm'` strings. A week
//      is addressed by its local Monday and a routine happens at a wall-clock
//      time; neither has an instant until a timezone is applied, and typing
//      them as `Date` is how a user west of Greenwich loses a day.
// =============================================================================

/** A local calendar date, `'YYYY-MM-DD'`. No instant, no timezone. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** A local wall-clock time, `'HH:mm'`. `24:00` is not a time of day. */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');

/** Mirrors Prisma's `Domain` (E02-01). */
export const domainEnum = z.enum(['WORK', 'FAMILY', 'HEALTH']);
export type WeeklyDomain = z.infer<typeof domainEnum>;

/** Mirrors Prisma's `DomainModeKind` (E02-01). */
export const domainModeEnum = z.enum(['GROW', 'MAINTAIN', 'RECOVER', 'PAUSE']);

/**
 * One domain's week, or the whole week's totals.
 *
 * `unresolved` is deliberately separate from `missed`: nothing marks a stale
 * commitment MISSED until E11-02's comeback loop, and reporting a row the user
 * simply never touched as a miss would be the product inventing a failure.
 */
export const domainCountsSchema = z.object({
  planned: z.number().int(),
  completed: z.number().int(),
  partial: z.number().int(),
  missed: z.number().int(),
  unresolved: z.number().int(),
  skipped: z.number().int(),
  rescheduled: z.number().int(),
  started: z.number().int(),
  fallbackUsed: z.number().int(),
  minutesPlanned: z.number().int(),
  minutesSpent: z.number().int(),
  completionRate: z.number().min(0).max(1),
});

export type DomainCounts = z.infer<typeof domainCountsSchema>;

export const timeWindowEnum = z.enum([
  'early_morning',
  'morning',
  'midday',
  'afternoon',
  'evening',
  'night',
]);

export type TimeWindow = z.infer<typeof timeWindowEnum>;

export const weekAggregatesSchema = z.object({
  weekStart: isoDate,
  timezone: z.string(),
  /**
   * How much of the week the numbers actually cover. A Wednesday review is not
   * a bad week — it is half a week, and saying so is the difference between
   * information and an accusation (VISION §29).
   */
  coverage: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    partial: z.boolean(),
  }),
  domains: z.object({
    WORK: domainCountsSchema,
    FAMILY: domainCountsSchema,
    HEALTH: domainCountsSchema,
  }),
  totals: domainCountsSchema,
  timeWindows: z.array(
    z.object({
      window: timeWindowEnum,
      planned: z.number().int(),
      completed: z.number().int(),
      successRate: z.number().min(0).max(1),
    }),
  ),
  /** Seven entries, Sunday first — the index IS the weekday. */
  weekdays: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        planned: z.number().int(),
        completed: z.number().int(),
      }),
    )
    .length(7),
  rescheduleLeaders: z
    .array(
      z.object({
        commitmentId: z.string().uuid(),
        title: z.string(),
        domain: domainEnum,
        rescheduleCount: z.number().int(),
      }),
    )
    .max(5),
  focusStarts: z.object({
    planned: z.number().int(),
    started: z.number().int(),
    completed: z.number().int(),
  }),
  workouts: z.object({
    planned: z.number().int(),
    completed: z.number().int(),
    fallbackUsed: z.number().int(),
    sessionsLogged: z.number().int(),
  }),
  frictionTags: z.array(z.object({ tag: z.string(), count: z.number().int() })),
});

export type WeekAggregates = z.infer<typeof weekAggregatesSchema>;

/**
 * PRD §14.4: a pattern is three separate claims and the user is entitled to see
 * which is which. "You completed 4 of 5 mornings" is an observation; "evenings
 * are less reliable for you" is an inference; "move it to Saturday" is a
 * recommendation. Collapsing them into one sentence is how a product states a
 * guess with the authority of a measurement.
 */
export const reviewPatternSchema = z.object({
  observation: z.string().min(1).max(240),
  inference: z.string().max(240).nullable(),
  recommendation: z.string().max(240).nullable(),
  confidence: z.number().min(0).max(1),
  domain: domainEnum.nullable(),
});

export type ReviewPattern = z.infer<typeof reviewPatternSchema>;

/** The PRD §14.6 six outputs, and nothing else. */
export const weeklyReviewOutputSchema = z.object({
  whatWorked: z.array(z.string().min(1).max(240)).max(5),
  whatDidNot: z.array(z.string().min(1).max(240)).max(5),
  patterns: z.array(reviewPatternSchema).max(3),
  proposedChanges: z
    .array(
      z.object({
        planId: z.string().uuid(),
        summary: z.string().min(1).max(300),
        changes: z.array(planChangeSchema).min(1).max(10),
      }),
    )
    .max(3),
  keepUnchanged: z.array(z.string().min(1).max(240)).max(5),
  doNotAddYet: z.array(z.string().min(1).max(240)).max(3),
});

export type WeeklyReviewOutput = z.infer<typeof weeklyReviewOutputSchema>;

/**
 * What is stored. `source` is the fact every consumer needs: a summary written
 * from the numbers because the provider was down must be labelled as such on
 * the screen, not silently presented as coaching (PRD §120).
 */
export const weeklyReviewSummarySchema = weeklyReviewOutputSchema.extend({
  source: z.enum(['ai', 'template']),
  promptVersion: z.string().nullable(),
  generatedAt: z.string().datetime(),
});

export type WeeklyReviewSummary = z.infer<typeof weeklyReviewSummarySchema>;

/** What the user says is already fixed about next week (PRD §50 step 2). */
export const weeklyPlanConstraintsSchema = z.object({
  travelDays: z.array(isoDate).max(7).default([]),
  fixedEvents: z
    .array(
      z.object({
        date: isoDate,
        title: z.string().min(1).max(120),
        /** Both null means the event blocks the whole day. */
        startTime: hhmm.nullable(),
        endTime: hhmm.nullable(),
      }),
    )
    .max(20)
    .default([]),
  notes: z.string().max(500).nullable().default(null),
});

export type WeeklyPlanConstraints = z.infer<typeof weeklyPlanConstraintsSchema>;

/**
 * Partial on purpose: a plan that names only FAMILY is saying "leave the others
 * as they are", which is different from asserting GROW for two domains the user
 * never looked at.
 */
export const weeklyDomainModesSchema = z
  .object({
    WORK: domainModeEnum,
    FAMILY: domainModeEnum,
    HEALTH: domainModeEnum,
  })
  .partial();

export type WeeklyDomainModes = z.infer<typeof weeklyDomainModesSchema>;
