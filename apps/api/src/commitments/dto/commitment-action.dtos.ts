import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { isoDateTime, refineSchedule } from './create-commitment.dto';

// =============================================================================
// Bodies for `/commitments/:id/actions/*` (issue #40, epic E05)
// =============================================================================
//
// Every one of these is small on purpose. An action endpoint says WHAT HAPPENED
// — the server decides what that implies for status, timestamps and evidence.
// A body that could set `status` would be a second, unvalidated way around the
// transition matrix, which is why none of them can.
// =============================================================================

/** A timer target. 180 minutes is three hours: past that it is not a session. */
const timerMinutes = z.number().int().min(1).max(180);

export const startActionSchema = z.object({
  /** The 5/10/20/custom target. Absent means an open-ended session. */
  minutes: timerMinutes.nullish(),
});

export class StartActionDto extends createZodDto(startActionSchema) {}

export const continueActionSchema = z.object({
  /** From the "Continue another 15?" prompt; added to the existing target. */
  extraMinutes: timerMinutes.nullish(),
});

export class ContinueActionDto extends createZodDto(continueActionSchema) {}

export const completeActionSchema = z.object({
  notes: z.string().trim().max(1000).nullish(),
  /** Overrides the timer's own count — the user is the authority on this. */
  minutesSpent: z.number().int().min(0).max(1440).nullish(),
});

export class CompleteActionDto extends createZodDto(completeActionSchema) {}

export const fallbackActionSchema = z.object({
  /** FULL is deliberately absent: this action means "I am doing less". */
  version: z.enum(['short', 'minimum']),
});

export class FallbackActionDto extends createZodDto(fallbackActionSchema) {}

export const rescheduleActionSchema = z
  .object({
    scheduledStart: isoDateTime,
    scheduledEnd: isoDateTime.nullish(),
  })
  .superRefine(refineSchedule);

export class RescheduleActionDto extends createZodDto(rescheduleActionSchema) {}

/**
 * PRD §74's quick options, minus "Plan worked" — that is a reflection on a plan,
 * not a reason to skip something.
 *
 * Stable keys, never the sentence shown to the user: E07 groups avoidance
 * patterns on these and a copy edit must not split a cohort.
 */
export const SKIP_REASONS = [
  'TOO_MUCH',
  'BAD_TIMING',
  'UNEXPECTED_CONFLICT',
  'LOW_ENERGY',
  'AVOIDED',
  'OTHER',
] as const;

export const skipReasonSchema = z.enum(SKIP_REASONS);
export type SkipReason = z.infer<typeof skipReasonSchema>;

export const skipActionSchema = z.object({
  reason: skipReasonSchema,
  /** The user's own words. Never written to an audit row or a log line. */
  text: z.string().trim().max(1000).nullish(),
});

export class SkipActionDto extends createZodDto(skipActionSchema) {}

export const decomposeActionSchema = z.object({
  /** "I only have 10 minutes", "I am stuck on the intro" — steers the coach. */
  hint: z.string().trim().max(300).nullish(),
});

export class DecomposeActionDto extends createZodDto(decomposeActionSchema) {}
