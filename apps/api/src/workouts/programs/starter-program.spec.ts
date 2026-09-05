import type { Equipment } from '@prisma/client';

import { buildStarterProgram, effectiveDaysPerWeek } from './starter-program';
import { checkProgram, type RuleContext } from './workout-program-rules';
import { workoutProgramProposalSchema } from './workout-program.schema';

// =============================================================================
// The fallback has to be correct on the day the model is not available, which
// is the day nobody is watching. So it is held to the SAME schema and the SAME
// rules the AI output has to pass, across the whole input space the DTO allows.
// =============================================================================

/**
 * The catalog tags for the movements the starter can pick. Only the ones a
 * limitation could plausibly hit; everything else is untagged.
 */
const CONTRAINDICATIONS = new Map<string, string[]>([
  ['goblet squat', ['knee']],
  ['bodyweight squat', ['knee']],
  ['dumbbell bench press', ['shoulder']],
  ['push-up', ['wrist', 'shoulder']],
  ['dumbbell row', []],
  ['band row', []],
  ['inverted row', []],
  ['dumbbell romanian deadlift', ['lower_back']],
  ['kettlebell swing', ['lower_back']],
  ['glute bridge', []],
  ['plank', ['lower_back', 'shoulder']],
]);

const EQUIPMENT_SETS: Array<{ label: string; equipment: Equipment[] }> = [
  { label: 'bodyweight only', equipment: ['BODYWEIGHT'] },
  { label: 'dumbbells and a bench', equipment: ['DUMBBELL', 'BENCH'] },
  { label: 'bands only', equipment: ['BAND'] },
  { label: 'a full gym', equipment: ['BARBELL', 'DUMBBELL', 'MACHINE', 'CABLE', 'BENCH'] },
];

describe('buildStarterProgram', () => {
  for (const experience of ['BEGINNER', 'INTERMEDIATE'] as const) {
    for (const daysPerWeek of [2, 3, 4, 5]) {
      for (const minutesPerSession of [20, 40, 75]) {
        for (const { label, equipment } of EQUIPMENT_SETS) {
          it(`is valid for ${experience.toLowerCase()} · ${daysPerWeek}d · ${minutesPerSession}m · ${label}`, () => {
            const req = { experience, daysPerWeek, minutesPerSession, equipment };
            const proposal = buildStarterProgram(req);

            expect(workoutProgramProposalSchema.safeParse(proposal).success).toBe(true);

            const context: RuleContext = {
              experience,
              // The rules are checked against the week the starter actually
              // scheduled: a beginner asking for five days is GIVEN four, and
              // asserting against the five they typed would fail a rule the
              // builder deliberately enforced.
              daysPerWeek: effectiveDaysPerWeek(req),
              minutesPerSession,
              contraindicationsByName: CONTRAINDICATIONS,
            };

            expect(checkProgram(proposal, context)).toEqual([]);
          });
        }
      }
    }
  }

  it('caps a beginner at four days however many they asked for', () => {
    const proposal = buildStarterProgram({
      experience: 'BEGINNER',
      daysPerWeek: 5,
      minutesPerSession: 40,
      equipment: ['BODYWEIGHT'],
    });

    expect(proposal.weeklyStructure).toHaveLength(4);
  });

  it('picks nothing that needs equipment the user does not have', () => {
    const proposal = buildStarterProgram({
      experience: 'BEGINNER',
      daysPerWeek: 3,
      minutesPerSession: 40,
      equipment: ['BODYWEIGHT'],
    });

    const names = proposal.templates.flatMap((t) => t.exercises.map((e) => e.exerciseName));

    expect(names).not.toContain('Goblet Squat');
    expect(names).not.toContain('Dumbbell Bench Press');
    expect(names).toContain('Bodyweight Squat');
    expect(names).toContain('Push-Up');
  });

  it('uses the dumbbell movements when there are dumbbells and a bench', () => {
    const proposal = buildStarterProgram({
      experience: 'BEGINNER',
      daysPerWeek: 3,
      minutesPerSession: 45,
      equipment: ['DUMBBELL', 'BENCH'],
    });

    const names = proposal.templates.flatMap((t) => t.exercises.map((e) => e.exerciseName));

    expect(names).toContain('Goblet Squat');
    expect(names).toContain('Dumbbell Bench Press');
  });

  it('degrades a 20-minute session rather than mislabelling a 35-minute one', () => {
    const short = buildStarterProgram({
      experience: 'BEGINNER',
      daysPerWeek: 3,
      minutesPerSession: 20,
      equipment: ['DUMBBELL', 'BENCH'],
    });
    const long = buildStarterProgram({
      experience: 'BEGINNER',
      daysPerWeek: 3,
      minutesPerSession: 75,
      equipment: ['DUMBBELL', 'BENCH'],
    });

    const full = (p: typeof short) => p.templates.find((t) => t.variant === 'FULL')!;

    expect(full(short).exercises.length).toBeLessThan(full(long).exercises.length);
    expect(full(short).targetMinutes).toBeLessThanOrEqual(22);
  });

  it('always offers a minimum version somebody can do in a hotel room', () => {
    const proposal = buildStarterProgram({
      experience: 'BEGINNER',
      daysPerWeek: 3,
      minutesPerSession: 40,
      equipment: ['BARBELL', 'MACHINE'],
    });

    for (const template of proposal.templates.filter((t) => t.variant === 'MINIMUM')) {
      expect(template.exercises.map((e) => e.exerciseName)).toEqual([
        'Bodyweight Squat',
        'Push-Up',
      ]);
      expect(template.targetMinutes).toBeLessThanOrEqual(12);
    }
  });
});
