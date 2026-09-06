import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { workSessionPlanSchema } from '../work-session-plan.schema';

// =============================================================================
// Bodies for `/outcomes/:id/plan-sessions*` (issue #108, epic E07)
// =============================================================================

/** A calendar date, `YYYY-MM-DD`. No time of day: a deadline has none. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

export const planSessionsSchema = z.object({
  /**
   * Overrides the outcome's own target date for this plan only. The outcome is
   * not edited here — moving a deadline is a decision, not a side effect of
   * asking for a schedule.
   */
  targetDate: calendarDate.nullish(),

  /**
   * How much focused work fits in a day. 240 is four hours: past that the
   * number is aspirational and the guardrails would wave through a week nobody
   * can do.
   */
  availableMinutesPerDay: z.number().int().min(10).max(240).nullish(),
});

export class PlanSessionsDto extends createZodDto(planSessionsSchema) {}

export const applySessionPlanSchema = z.object({
  proposalId: z.string().uuid(),

  /**
   * The user's edited copy. Absent means "apply exactly what was proposed" —
   * and the stored copy is used, never a body the client claims is unchanged.
   */
  proposal: workSessionPlanSchema.nullish(),
});

export class ApplySessionPlanDto extends createZodDto(applySessionPlanSchema) {}
