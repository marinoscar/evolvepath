import { z } from 'zod';

// =============================================================================
// The session-plan contract (issue #108, epic E07)
// =============================================================================
//
// ONE SCHEMA, THREE READERS: the `planner` persona's structured-output contract,
// the shape the deterministic template must satisfy, and the shape an edited
// copy is re-validated against at `apply`. A second declaration anywhere would
// let the user apply something the model could never have produced — or, worse,
// let the model produce something the apply transaction has no column for.
//
// The bounds are the product's opinions, not defensive programming:
//
//   * 8 milestones — past that they are phases, and PRD §24 asks for
//     deliverables.
//   * 20 sessions and 10..120 minutes — a plan that cannot be read on a phone
//     is not a plan the user will follow (PRD §123).
//   * `minimumStart` is REQUIRED on every session. VISION §10: ten minutes on
//     something avoided for three days is progress, and the only way to
//     guarantee the product can always offer that is to refuse a plan without it.
// =============================================================================

/** The smallest honest version of a session — what a tired person can do. */
export const minimumStartSchema = z.object({
  title: z.string().min(3).max(160),
  minutes: z.number().int().min(2).max(15),
});

export const workSessionPlanSchema = z.object({
  milestones: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        order: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(8),

  sessions: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        /** ISO-8601 with an offset: a session happens at an instant. */
        scheduledStart: z.string().datetime({ offset: true }),
        durationMinutes: z.number().int().min(10).max(120),
        milestoneIndex: z.number().int().min(0),
        minimumStart: minimumStartSchema,
      }),
    )
    .min(1)
    .max(20),

  /**
   * PRD §24's implementation intention, as the "After … → I …" pair the user
   * will actually recognise in their own day.
   */
  implementationIntention: z.object({
    when: z.string().min(3).max(160),
    then: z.string().min(3).max(160),
  }),

  reviewCadence: z.enum(['DAILY', 'TWICE_WEEKLY', 'WEEKLY']),

  /** Why this shape. Rendered under the proposal; never interpreted. */
  rationale: z.string().max(800),
});

export type WorkSessionPlan = z.infer<typeof workSessionPlanSchema>;

/** `json_schema.name` on the wire. */
export const WORK_SESSION_PLAN_SCHEMA_NAME = 'work_session_plan';

/** Captured on every `ai_invocations` row this feature writes (PRD §117). */
export const WORK_SESSION_PLAN_PROMPT_VERSION = 'work-session-plan.v1';
