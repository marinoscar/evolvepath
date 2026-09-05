import { z } from 'zod';

// =============================================================================
// The shape of a proposed plan change (issue #76, epic E06)
// =============================================================================
//
// PRD §15 fixes the protocol: AI produces a proposal → the product displays a
// diff → the user approves or edits → the plan service validates → a new
// version becomes active. This file is the wire format of the first step, and
// it is deliberately a SMALL CLOSED VOCABULARY rather than a patch document.
//
// Six operations, not arbitrary JSON, because the user has to be shown what is
// about to happen in a sentence they can refuse. "Move Wednesday 18:30 to
// Saturday 09:00" is reviewable; a JSON Patch against a routine row is not —
// and a proposal nobody can read is a proposal everybody accepts.
//
// `reason` is required on every change and bounded at 200 characters. PRD §80
// wants version history to carry why the plan changed, and the only moment
// that reason exists is when the change is proposed. Collecting it later means
// reconstructing it, which means guessing.
// =============================================================================

export const PLAN_CHANGE_OPS = [
  'move',
  'reduce',
  'replace',
  'add',
  'remove',
  'pause',
] as const;

export type PlanChangeOp = (typeof PLAN_CHANGE_OPS)[number];

/**
 * A partial `Routine` (E02-01). Field names match the Prisma model so a
 * snapshot can be spread onto a row without a translation table nobody
 * maintains.
 */
export const routineSnapshotSchema = z
  .object({
    title: z.string().min(1).max(200),
    triggerType: z.enum(['TIME', 'EVENT']),
    triggerValue: z.string().max(200).nullable(),
    frequency: z.enum(['DAILY', 'WEEKDAYS', 'WEEKENDS', 'WEEKLY', 'CUSTOM']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
    preferredTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'preferredTime must be HH:mm')
      .nullable(),
    estimatedDurationMin: z.number().int().min(1).max(1440),
    minimumDurationMin: z.number().int().min(1).max(1440),
    fallbackBehavior: z.string().max(500).nullable(),
    active: z.boolean(),
  })
  .partial();

export type RoutineSnapshot = z.infer<typeof routineSnapshotSchema>;

export const planChangeSchema = z
  .object({
    op: z.enum(PLAN_CHANGE_OPS),
    target: z.object({
      type: z.enum(['routine', 'commitment']),
      /** Null only for `add`, which has nothing to point at yet. */
      id: z.string().uuid().nullable(),
    }),
    before: routineSnapshotSchema.nullable(),
    after: routineSnapshotSchema.nullable(),
    reason: z.string().trim().min(1).max(200),
    /**
     * The Health domain's additive extension (issue #88, epic E09).
     *
     * OPTIONAL, AND `applyChanges` IGNORES IT. A workout proposal is still an
     * ordinary routine-targeted change — that is what makes it renderable by
     * E06-07's proposal card with no workout-specific code — but a swapped
     * exercise is a fact about a template that no routine snapshot can carry.
     * It travels here and is applied by `WorkoutProposalEffect` inside the same
     * accept transaction.
     *
     * Kept out of the routine snapshot deliberately: putting template ids in
     * `after` would make E06's pure diff depend on tables it knows nothing
     * about.
     */
    workout: z
      .object({
        templateId: z.string().uuid(),
        replaceExercise: z
          .object({
            templateExerciseId: z.string().uuid(),
            alternativeExerciseId: z.string().uuid(),
          })
          .optional(),
      })
      .optional(),
  })
  .superRefine((change, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (change.op === 'add') {
      // An `add` that names a target is either a `replace` in disguise or a
      // mistake, and both would apply to something the user did not review.
      if (change.target.id !== null) fail('add must not name a target', ['target', 'id']);
      if (!change.after) fail('add requires an "after" snapshot', ['after']);
      return;
    }

    if (change.target.id === null) {
      fail(`${change.op} requires a target id`, ['target', 'id']);
      return;
    }

    switch (change.op) {
      case 'move':
        // "Move" that moves nothing is the most likely way for a model to
        // produce a change the user accepts and then cannot see the effect of.
        if (!change.after?.preferredTime && !change.after?.triggerValue) {
          fail('move requires a new preferredTime or triggerValue', ['after']);
        }
        break;

      case 'reduce':
        if (
          change.after?.estimatedDurationMin === undefined ||
          change.before?.estimatedDurationMin === undefined
        ) {
          fail('reduce requires estimatedDurationMin on both snapshots', ['after']);
        } else if (change.after.estimatedDurationMin >= change.before.estimatedDurationMin) {
          // A "reduce" that increases the load is the one wrong answer a user
          // is most likely to accept without reading — it is the op they asked
          // for, so the number is the only thing telling them otherwise.
          fail('reduce must lower estimatedDurationMin', ['after', 'estimatedDurationMin']);
        }
        break;

      case 'replace':
        if (!change.before || !change.after) {
          fail('replace requires both snapshots', ['after']);
        }
        break;

      case 'remove':
      case 'pause':
        break;
    }
  });

export type PlanChange = z.infer<typeof planChangeSchema>;

export const planChangeListSchema = z.array(planChangeSchema).min(1).max(10);
