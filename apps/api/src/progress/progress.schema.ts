import { z } from 'zod';

import { domainSchema } from '../path/domain.schema';
import { MOMENTUM_STATES } from './momentum/momentum-engine';

// =============================================================================
// The Progress contract (issue #98, epic E11)
// =============================================================================
//
// THERE IS NO SCORE IN THIS FILE, and its absence is the point (PRD P13, §54).
// The engine computes ratios internally because trends are comparisons, but
// `ratio`, `recentRatio` and `priorRatio` are deliberately NOT serialised: a
// ratio on the wire is one pull request away from a percentage badge, and the
// cheapest way to keep that from happening is for the number never to leave
// the server.
//
// The one `ratio` in this document is `independence.ratio`, which measures the
// PRODUCT (how often the user acts without being reminded), not the person.
// =============================================================================

export const momentumStateEnum = z.enum(
  MOMENTUM_STATES as unknown as [string, ...string[]],
);

export const momentumSignalsSchema = z.object({
  planned: z.number().int(),
  completed: z.number().int(),
  partial: z.number().int(),
  fallback: z.number().int(),
  missed: z.number().int(),
  skipped: z.number().int(),
  consecutiveMisses: z.number().int(),
  rescheduledTwice: z.number().int(),
  lastCompletionAt: z.string().datetime().nullable(),
  lastMissAt: z.string().datetime().nullable(),
  returnedAfterIdleDays: z.number().int().nullable(),
});

export const trendPointSchema = z.object({
  weekStart: z.string(),
  planned: z.number().int(),
  completed: z.number().int(),
});

export const momentumSchema = z.object({
  domain: domainSchema,
  state: momentumStateEnum,
  /** Counts and sentences. Never a percentage — see the header. */
  evidence: z.array(z.string()).max(3),
  signals: momentumSignalsSchema,
  /** Last four weeks in this domain, ascending. */
  trend: z.array(trendPointSchema).length(4),
});

export const weekStatSchema = z.object({
  weekStart: z.string(),
  planned: z.number().int(),
  completed: z.number().int(),
  success: z.boolean(),
  graced: z.boolean(),
  current: z.boolean(),
});

export const milestoneSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  /** The n-th of a repeatable kind; 1 for the one-off kinds. */
  sequence: z.number().int(),
  domain: domainSchema.nullable(),
  achievedAt: z.string().datetime(),
  /** Null until the user has been shown it — PRD §77 celebrates once. */
  acknowledgedAt: z.string().datetime().nullable(),
  title: z.string(),
  body: z.string(),
  meta: z.record(z.string(), z.unknown()),
});

export type MilestonePayload = z.infer<typeof milestoneSchema>;

export const progressResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  windowDays: z.literal(28),
  momentum: z.object({
    WORK: momentumSchema,
    FAMILY: momentumSchema,
    HEALTH: momentumSchema,
  }),
  consistencyRun: z.object({
    weeks: z.number().int(),
    graceUsed: z.number().int(),
    weekly: z.array(weekStatSchema).max(12),
  }),
  recovery: z.object({
    medianDays: z.number().nullable(),
    samples: z.number().int(),
  }),
  independence: z.object({
    ratio: z.number().min(0).max(1).nullable(),
    completedWithoutReminder: z.number().int(),
    sampleSize: z.number().int(),
  }),
  /** The ten most recent, plus everything still unacknowledged (E11-03). */
  milestones: z.array(milestoneSchema),
  /** The caller's confirmed memory insights (E06-05), never the hidden ones. */
  insights: z.array(
    z.object({
      id: z.string().uuid(),
      category: z.string(),
      statement: z.string(),
    }),
  ),
});

export type ProgressResponse = z.infer<typeof progressResponseSchema>;
export type MomentumPayload = z.infer<typeof momentumSchema>;
export type WeekStatPayload = z.infer<typeof weekStatSchema>;
