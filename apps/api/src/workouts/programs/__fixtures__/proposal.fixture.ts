import type { WorkoutProgramProposal } from '../workout-program.schema';

/**
 * A proposal that passes the schema and the rules for
 * `{ experience: 'BEGINNER', daysPerWeek: 2, minutesPerSession: 45 }`.
 *
 * Deliberately minimal — two training days, four movements — so a spec that
 * breaks it breaks on the thing it changed rather than on the fixture's size.
 */
export function validProposal(
  overrides: Partial<WorkoutProgramProposal> = {},
): WorkoutProgramProposal {
  const upper = {
    name: 'Upper A',
    variant: 'FULL' as const,
    targetMinutes: 40,
    exercises: [
      {
        exerciseName: 'Dumbbell Bench Press',
        sets: 3,
        repMin: 8,
        repMax: 12,
        restSeconds: 90,
        notes: null,
      },
      { exerciseName: 'Dumbbell Row', sets: 3, repMin: 8, repMax: 12, restSeconds: 90, notes: null },
    ],
  };

  const lower = {
    name: 'Lower A',
    variant: 'FULL' as const,
    targetMinutes: 40,
    exercises: [
      { exerciseName: 'Goblet Squat', sets: 3, repMin: 8, repMax: 12, restSeconds: 90, notes: null },
      { exerciseName: 'Glute Bridge', sets: 3, repMin: 8, repMax: 12, restSeconds: 90, notes: null },
    ],
  };

  const siblings = [upper, lower].flatMap((template) => [
    {
      ...template,
      variant: 'SHORT' as const,
      targetMinutes: 24,
      exercises: [template.exercises[0]],
    },
    {
      ...template,
      variant: 'MINIMUM' as const,
      targetMinutes: 10,
      exercises: [{ ...template.exercises[0], sets: 2 }],
    },
  ]);

  return {
    programName: 'Two-day upper/lower',
    durationWeeks: 6,
    weeklyStructure: [
      { weekday: 1, templateName: 'Upper A' },
      { weekday: 4, templateName: 'Lower A' },
    ],
    templates: [upper, lower, ...siblings],
    progressionMethod: 'DOUBLE_PROGRESSION',
    substitutions: [{ exerciseName: 'Dumbbell Row', alternatives: ['Band Row'] }],
    rationale: 'Two sessions a week, four movements, room to add weight.',
    ...overrides,
  };
}
