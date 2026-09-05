import { z } from 'zod';

import { planChangeSchema } from '../proposals/plan-change.schema';

// =============================================================================
// The coaching contract (issue #70, epic E06)
// =============================================================================
//
// PRD §16: the coach answers in a validated structured object, never free
// prose. Two things follow from that, and both are the point:
//
//   * `reasoning_summary` is a SUMMARY. It is the one or two sentences the
//     user may expand under "Why this?" — never chain of thought, which PRD
//     §16/§88 say is not stored and not shown. Bounded at 400 characters so it
//     cannot quietly become a transcript of the model's working.
//   * `intervention_type` makes the reply CLASSIFIABLE. E11 asks which kinds of
//     coaching actually move behaviour, and that question is only answerable if
//     every reply carries its own label.
//
// EVERYTHING OPTIONAL IS `.nullable()`, NOT `.optional()`. The gateway emits
// `strict: true` JSON schemas, where every declared property is required;
// `toOpenAiStrictSchema` turns an optional property into a nullable required
// one, so `.nullable()` is the shape that round-trips losslessly. The service
// maps null to "absent" on the way out.
// =============================================================================

/**
 * PRD §26's intervention ladder (levels 0–6) plus VISION §21's coaching modes.
 * Frozen: E11 groups telemetry on these strings.
 */
export const INTERVENTION_TYPES = [
  'NORMAL_REMINDER',
  'ACTIVATION_REDUCTION',
  'DECOMPOSITION',
  'FRICTION_DIAGNOSIS',
  'ENVIRONMENT_CHANGE',
  'PLAN_CHALLENGE',
  'GOAL_CHALLENGE',
  'REINFORCE',
  'CLARIFY',
  'REDUCE_SCOPE',
  'RECONNECT_REASON',
  'RECOVER',
] as const;

export type InterventionType = (typeof INTERVENTION_TYPES)[number];

const actionSchema = z.object({
  title: z.string().min(1).max(120),
  duration_minutes: z.number().int().min(1).max(180),
  /** Must be an id from the context. `coach-output-guard.ts` enforces it. */
  commitmentId: z.string().uuid().nullable(),
});

export const coachReplySchema = z.object({
  intervention_type: z.enum(INTERVENTION_TYPES),

  /** Shown under "Why this?". A summary, never the model's working. */
  reasoning_summary: z.string().min(1).max(400),

  /** What the user reads. Capped at 600 chars — PRD §67 wants four sentences. */
  user_message: z.string().min(1).max(600),

  recommended_action: actionSchema.nullable(),
  fallback_action: z
    .object({
      title: z.string().min(1).max(120),
      duration_minutes: z.number().int().min(1).max(180),
    })
    .nullable(),

  /**
   * A proposed plan change. NOT a plan change: this becomes a
   * `PlanChangeProposal` row and waits on the user (PRD §15).
   */
  proposal: z
    .object({
      kind: z.literal('plan_change'),
      planId: z.string().uuid(),
      summary: z.string().min(1).max(300),
      changes: z.array(planChangeSchema).min(1).max(10),
    })
    .nullable(),

  friction_question: z
    .object({
      prompt: z.string().min(1).max(200),
      options: z.array(z.string().min(1).max(80)).min(2).max(5),
    })
    .nullable(),
});

export type CoachReply = z.infer<typeof coachReplySchema>;

/** `json_schema.name` on the wire. */
export const COACH_SCHEMA_NAME = 'coach_reply';
