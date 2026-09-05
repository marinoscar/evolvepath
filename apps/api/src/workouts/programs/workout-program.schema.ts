import { z } from 'zod';

// =============================================================================
// The workout programmer's output contract (issue #77, epic E09)
// =============================================================================
//
// PRD §37 fixes what the builder must produce; this file is that list, as a
// schema the gateway validates BEFORE any caller sees it. Two decisions in here
// are worth stating plainly, because both look like extra work until the day
// they are not:
//
//   1. THE MODEL NAMES EXERCISES, IT DOES NOT IDENTIFY THEM. Every reference is
//      an `exerciseName` string resolved against the catalog afterwards
//      (`ExerciseResolverService`). Asking a model for uuids invites it to
//      invent one, and an invented uuid is a foreign-key error at insert time
//      rather than a name a human can read and correct.
//
//   2. THE THREE SIZES ARE STRUCTURAL, NOT OPTIONAL. `superRefine` rejects a
//      FULL template with no SHORT or MINIMUM sibling, because PRD §44's
//      promise — "there is always a version of this you can do today" — is only
//      true if the small version exists before the bad day does.
//
// `superRefine` also enforces the two things a plain schema cannot say:
// `repMin <= repMax`, and that every scheduled day names a FULL template. Both
// are the kind of quiet nonsense a model produces occasionally and a user would
// have to notice for us.
// =============================================================================

/** Bumped whenever `PROGRAM_INSTRUCTIONS` changes meaningfully (PRD §117). */
export const PROGRAM_PROMPT_VERSION = 'workout_programmer.v1';

/** `json_schema.name` on the wire. */
export const PROGRAM_SCHEMA_NAME = 'workout_program';

export const workoutVariantEnum = z.enum(['FULL', 'SHORT', 'MINIMUM']);

export const proposedExerciseSchema = z.object({
  exerciseName: z.string().min(2).max(80),
  sets: z.number().int().min(1).max(6),
  repMin: z.number().int().min(1).max(30),
  repMax: z.number().int().min(1).max(30),
  restSeconds: z.number().int().min(30).max(240),
  notes: z.string().max(200).nullable(),
});

export const proposedTemplateSchema = z.object({
  name: z.string().min(2).max(60),
  variant: workoutVariantEnum,
  targetMinutes: z.number().int().min(8).max(90),
  exercises: z.array(proposedExerciseSchema).min(1).max(10),
});

export const proposedWeekdaySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  templateName: z.string().min(2).max(60),
});

export const proposedSubstitutionSchema = z.object({
  exerciseName: z.string().min(2).max(80),
  alternatives: z.array(z.string().min(2).max(80)).min(1).max(3),
});

const baseProgramSchema = z.object({
  programName: z.string().min(3).max(80),
  durationWeeks: z.number().int().min(4).max(12),
  weeklyStructure: z.array(proposedWeekdaySchema).min(2).max(5),
  templates: z.array(proposedTemplateSchema).min(3),
  progressionMethod: z.literal('DOUBLE_PROGRESSION'),
  substitutions: z.array(proposedSubstitutionSchema),
  rationale: z.string().max(1200),
});

export const workoutProgramProposalSchema = baseProgramSchema.superRefine((value, ctx) => {
  const full = value.templates.filter((t) => t.variant === 'FULL');
  const byName = new Map<string, Set<string>>();

  for (const template of value.templates) {
    const variants = byName.get(template.name) ?? new Set<string>();
    variants.add(template.variant);
    byName.set(template.name, variants);
  }

  if (full.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'No FULL template', path: ['templates'] });
  }

  for (const template of full) {
    const variants = byName.get(template.name)!;

    for (const required of ['SHORT', 'MINIMUM'] as const) {
      if (!variants.has(required)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${template.name}" has no ${required} version`,
          path: ['templates'],
        });
      }
    }
  }

  value.templates.forEach((template, index) => {
    template.exercises.forEach((exercise, exerciseIndex) => {
      if (exercise.repMin > exercise.repMax) {
        ctx.addIssue({
          code: 'custom',
          message: `repMin ${exercise.repMin} is above repMax ${exercise.repMax}`,
          path: ['templates', index, 'exercises', exerciseIndex],
        });
      }
    });
  });

  const weekdays = new Set<number>();

  value.weeklyStructure.forEach((day, index) => {
    if (weekdays.has(day.weekday)) {
      ctx.addIssue({
        code: 'custom',
        message: `weekday ${day.weekday} is scheduled twice`,
        path: ['weeklyStructure', index],
      });
    }
    weekdays.add(day.weekday);

    if (!full.some((t) => t.name === day.templateName)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${day.templateName}" is not a FULL template`,
        path: ['weeklyStructure', index],
      });
    }
  });
});

export type WorkoutProgramProposal = z.infer<typeof workoutProgramProposalSchema>;
export type ProposedTemplate = z.infer<typeof proposedTemplateSchema>;
export type ProposedExercise = z.infer<typeof proposedExerciseSchema>;

// -----------------------------------------------------------------------------
// The JSON columns on `workout_programs`
// -----------------------------------------------------------------------------

/** `workout_programs.weekly_structure` — resolved to template ids after insert. */
export const weeklyStructureSchema = z.array(
  z.object({ weekday: z.number().int().min(0).max(6), templateId: z.string().uuid() }),
);

export type WeeklyStructure = z.infer<typeof weeklyStructureSchema>;

/** `workout_programs.substitutions` — resolved to exercise ids after insert. */
export const programSubstitutionsSchema = z.array(
  z.object({ exerciseId: z.string().uuid(), alternativeExerciseIds: z.array(z.string().uuid()) }),
);

export type ProgramSubstitutions = z.infer<typeof programSubstitutionsSchema>;
