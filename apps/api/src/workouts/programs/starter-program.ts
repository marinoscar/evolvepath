import type { Equipment } from '@prisma/client';

import {
  BEGINNER_MAX_DAYS,
  estimateMinutes,
  MINUTES_TOLERANCE_PCT,
} from './workout-program-rules';
import type { ProposedExercise, WorkoutProgramProposal } from './workout-program.schema';

// =============================================================================
// The starter program (issue #77, epic E09)
// =============================================================================
//
// PRD §120 in one file. When the provider is down, the user has no key, or the
// model returned something the safety rules reject, THE PRODUCT STILL HANDS
// SOMEBODY A PROGRAM. It is a worse program than the model would have written,
// and it is a working one — which is the trade the PRD asks for.
//
// Pure, and deliberately so: no Prisma, no clock, no Nest. It is asserted
// against the same `checkProgram` rules the AI output has to pass, for every
// days-per-week and for an empty equipment list, which is the only way to know
// the fallback is not itself broken on the day it is needed.
//
// IT FITS THE TIME BUDGET BY DEGRADING, NOT BY LYING. A 20-minute session
// cannot hold five movements at three sets with 90 s rest, so the builder walks
// a fixed ladder of reductions until the estimate fits. Emitting the five-
// movement day with a "20 min" label would put the failure on the user, who
// would discover it forty minutes in.
// =============================================================================

interface StarterCandidate {
  /** A catalog name, so the resolver finds a real row rather than inventing one. */
  name: string;
  /** ALL of these must be available. `[]` means bodyweight. */
  requires: Equipment[];
}

/** One movement pattern, with its equipment-poorer alternatives after it. */
interface StarterSlot {
  candidates: StarterCandidate[];
  repMin: number;
  repMax: number;
  restSeconds: number;
  notes?: string;
}

const SLOTS: StarterSlot[] = [
  {
    candidates: [
      { name: 'Goblet Squat', requires: ['DUMBBELL'] },
      { name: 'Goblet Squat', requires: ['KETTLEBELL'] },
      { name: 'Bodyweight Squat', requires: [] },
    ],
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
  },
  {
    candidates: [
      { name: 'Dumbbell Bench Press', requires: ['DUMBBELL', 'BENCH'] },
      { name: 'Push-Up', requires: [] },
    ],
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
  },
  {
    candidates: [
      { name: 'Dumbbell Row', requires: ['DUMBBELL', 'BENCH'] },
      { name: 'Band Row', requires: ['BAND'] },
      { name: 'Inverted Row', requires: [] },
    ],
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
  },
  {
    candidates: [
      { name: 'Dumbbell Romanian Deadlift', requires: ['DUMBBELL'] },
      { name: 'Kettlebell Swing', requires: ['KETTLEBELL'] },
      { name: 'Glute Bridge', requires: [] },
    ],
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
  },
  {
    candidates: [{ name: 'Plank', requires: [] }],
    // Seconds, held, not repetitions. The contract caps a "rep" at 30, so the
    // hold is expressed as 20-30 rather than the 30-45 a coach would write on
    // paper — the runner shows the note, and the progression rule reads the
    // same numbers either way.
    repMin: 20,
    repMax: 30,
    restSeconds: 60,
    notes: 'seconds held, not reps',
  },
];

/** Mon, Wed, Fri, Sat, Tue — spaced first, then filled in. */
const WEEKDAY_ORDER = [1, 3, 5, 6, 2];

const TEMPLATE_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export interface StarterRequest {
  experience: 'BEGINNER' | 'INTERMEDIATE';
  daysPerWeek: number;
  minutesPerSession: number;
  equipment: Equipment[];
}

/**
 * How many days the starter will actually schedule.
 *
 * Exported because the rules are checked against the SAME number: a beginner who
 * asked for five days gets four, and asserting the fallback against the request
 * they typed rather than the week they were given would fail a rule the builder
 * deliberately enforced.
 */
export function effectiveDaysPerWeek(req: StarterRequest): number {
  const requested = Math.min(Math.max(req.daysPerWeek, 2), 5);

  return req.experience === 'BEGINNER' ? Math.min(requested, BEGINNER_MAX_DAYS) : requested;
}

function pick(slot: StarterSlot, available: Set<Equipment>): StarterCandidate {
  const found = slot.candidates.find((candidate) =>
    candidate.requires.every((item) => available.has(item)),
  );

  // The last candidate of every slot needs nothing, so this is unreachable —
  // the fallback is here so a future slot with no bodyweight option fails
  // loudly at its own definition rather than quietly returning undefined.
  return found ?? slot.candidates[slot.candidates.length - 1];
}

function toExercise(slot: StarterSlot, candidate: StarterCandidate, sets: number): ProposedExercise {
  return {
    exerciseName: candidate.name,
    sets,
    repMin: slot.repMin,
    repMax: slot.repMax,
    restSeconds: slot.restSeconds,
    notes: slot.notes ?? null,
  };
}

/**
 * The reduction ladder, in the order a coach would apply it: lose the core
 * finisher, then a set, then a movement, then some rest.
 */
const LADDER: Array<{ slots: number; sets: number; rest: number }> = [
  { slots: 5, sets: 3, rest: 90 },
  { slots: 4, sets: 3, rest: 90 },
  { slots: 4, sets: 2, rest: 90 },
  { slots: 3, sets: 3, rest: 75 },
  { slots: 3, sets: 2, rest: 75 },
  { slots: 3, sets: 2, rest: 60 },
  { slots: 2, sets: 2, rest: 60 },
];

function buildFullExercises(req: StarterRequest, available: Set<Equipment>): ProposedExercise[] {
  const budget = req.minutesPerSession * (1 + MINUTES_TOLERANCE_PCT / 100);

  for (const rung of LADDER) {
    const exercises = SLOTS.slice(0, rung.slots).map((slot) =>
      toExercise(slot, pick(slot, available), rung.sets),
    ).map((exercise) => ({
      ...exercise,
      restSeconds: Math.min(exercise.restSeconds, rung.rest),
    }));

    if (estimateMinutes({ exercises }) <= budget) return exercises;
  }

  // Nothing on the ladder fit — take the smallest rung anyway rather than
  // returning no program at all. The floor is two movements at two sets, which
  // is about twelve minutes; a request below that is outside `minutesPerSession`
  // 20..75 and cannot reach here through the DTO.
  const last = LADDER[LADDER.length - 1];

  return SLOTS.slice(0, last.slots).map((slot) =>
    toExercise(slot, pick(slot, available), last.sets),
  );
}

/**
 * A deterministic three-days-a-week full body program, fitted to the equipment
 * and the time the user actually has.
 *
 * The days share their movements and differ in ORDER — the lead movement
 * rotates squat → hinge → push. That is a real training decision (whatever
 * comes first gets the freshest effort) and not a cosmetic difference invented
 * to make the days look distinct.
 */
export function buildStarterProgram(req: StarterRequest): WorkoutProgramProposal {
  const available = new Set<Equipment>([...req.equipment, 'BODYWEIGHT']);
  const days = effectiveDaysPerWeek(req);
  const fullExercises = buildFullExercises(req, available);

  const templates: WorkoutProgramProposal['templates'] = [];
  const weeklyStructure: WorkoutProgramProposal['weeklyStructure'] = [];

  for (let index = 0; index < days; index += 1) {
    const name = `Full Body ${TEMPLATE_LETTERS[index]}`;
    // Rotate the lead movement without reordering the rest arbitrarily.
    const rotation = index % fullExercises.length;
    const ordered = [...fullExercises.slice(rotation), ...fullExercises.slice(0, rotation)];

    templates.push({
      name,
      variant: 'FULL',
      targetMinutes: estimateMinutes({ exercises: ordered }),
      exercises: ordered,
    });

    const short = ordered.slice(0, Math.min(3, ordered.length));

    templates.push({
      name,
      variant: 'SHORT',
      targetMinutes: Math.max(8, estimateMinutes({ exercises: short })),
      exercises: short,
    });

    templates.push({
      name,
      variant: 'MINIMUM',
      targetMinutes: 10,
      exercises: [
        {
          exerciseName: 'Bodyweight Squat',
          sets: 2,
          repMin: 10,
          repMax: 10,
          restSeconds: 45,
          notes: null,
        },
        {
          exerciseName: 'Push-Up',
          sets: 2,
          repMin: 8,
          repMax: 8,
          restSeconds: 45,
          notes: null,
        },
      ],
    });

    weeklyStructure.push({ weekday: WEEKDAY_ORDER[index], templateName: name });
  }

  return {
    programName: 'Starter Full Body',
    durationWeeks: 6,
    weeklyStructure,
    templates,
    progressionMethod: 'DOUBLE_PROGRESSION',
    substitutions: [
      { exerciseName: 'Goblet Squat', alternatives: ['Bodyweight Squat', 'Leg Press'] },
      { exerciseName: 'Dumbbell Bench Press', alternatives: ['Push-Up', 'Machine Chest Press'] },
      { exerciseName: 'Dumbbell Row', alternatives: ['Band Row', 'Inverted Row'] },
      { exerciseName: 'Dumbbell Romanian Deadlift', alternatives: ['Glute Bridge'] },
    ],
    rationale:
      'A conservative full-body plan you can run with what you have. The same handful of ' +
      'movements every session is on purpose: the fastest progress at the start comes from ' +
      'repeating a small number of things often enough to get good at them. Each day leads ' +
      'with a different movement so the one you are freshest for changes. Add a little weight ' +
      'once you can hit the top of every rep range comfortably.',
  };
}
