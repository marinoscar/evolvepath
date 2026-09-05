import { z } from 'zod';

import { commitmentCardSchema } from '../commitments/commitment-card.schema';
import { domainModeKindSchema, domainSchema } from '../path/domain.schema';
import { INTERVENTION_MODES } from './nba/intervention-mode';

// =============================================================================
// The Today response (issue #38, epic E05)
// =============================================================================
//
// The Zod schema is the CONTRACT — it is what the tests parse responses against
// and what `TodayResponse` is inferred from. The `@ApiProperty` classes in
// `dto/` exist only so the reference renders a shape.
//
// `commitmentCardSchema` is imported rather than redeclared: the card a domain
// section renders and the card an action endpoint returns must be the same
// shape, or the screen would show one thing before an action and another after.
// =============================================================================

export const checkInFeelSchema = z.enum([
  'NORMAL',
  'PACKED',
  'LOW_ENERGY',
  'UNEXPECTED_PROBLEM',
]);

export type CheckInFeelValue = z.infer<typeof checkInFeelSchema>;

export const interventionModeSchema = z.enum(INTERVENTION_MODES);

export const nextBestActionSchema = z.object({
  commitmentId: z.string().uuid(),
  title: z.string(),
  domain: domainSchema,
  durationMinutes: z.number().int().min(1),
  version: z.enum(['full', 'short', 'minimum']),
  /** Deterministic, template-built. Never AI — PRD §120. */
  rationale: z.string(),
  /** The smaller thing to offer beside it, so a bad day is never a zero. */
  fallback: z.object({ title: z.string(), durationMinutes: z.number().int().min(1) }),
  interventionMode: interventionModeSchema,
  confidence: z.number().min(0).max(1),
});

export const todayDomainSchema = z.object({
  domain: domainSchema,
  mode: domainModeKindSchema,
  commitments: z.array(commitmentCardSchema),
});

export const todayResponseSchema = z.object({
  /** "Good morning, Alex" — resolved in the user's own timezone. */
  greeting: z.string(),
  /** "3 commitments today. Health is in maintenance mode this week." */
  stateLine: z.string(),
  dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string(),
  checkIn: z.object({ feel: checkInFeelSchema }).nullable(),
  /** Null when there is nothing to recommend — an empty day is not a failure. */
  nextBestAction: nextBestActionSchema.nullable(),
  /** Always three, in canonical order, including any that are empty or paused. */
  domains: z.array(todayDomainSchema).length(3),
  /** E11 replaces this with its own schema. */
  momentum: z.null(),
  /**
   * ALWAYS null here. The coach's sentence is fetched separately from
   * `GET /today/insight` so a slow or dead provider cannot delay this response
   * — PRD §120 makes that a structural promise rather than a timeout setting.
   */
  coachInsight: z.null(),
});

export type TodayResponse = z.infer<typeof todayResponseSchema>;
export type NextBestAction = z.infer<typeof nextBestActionSchema>;

export const todayInsightSchema = z.object({
  text: z.string(),
  source: z.enum(['ai', 'template']),
  generatedAt: z.string().datetime(),
});

export type TodayInsight = z.infer<typeof todayInsightSchema>;
