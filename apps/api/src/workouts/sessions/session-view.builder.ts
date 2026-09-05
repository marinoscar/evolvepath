import type { Prisma } from '@prisma/client';

import { PAIN_SAFETY_COPY } from '../safety/workout-safety-copy';

import type {
  SessionExerciseDto,
  SetLogDto,
  WorkoutSessionViewDto,
} from '../dto/workout-session.dtos';

// =============================================================================
// Assembling what the runner renders (issue #81, epic E09)
// =============================================================================
//
// PURE. Rows in, view out — no Prisma, no clock, no Nest. Three callers reach
// it (start, read, switch-variant) and one spec drives it directly, which is
// the whole reason it is not a private method on the service.
//
// TWO SHAPES IN HERE ARE THE PRODUCT, not plumbing:
//
//   • `lastTime` is VISION §14's "next time, EvolvePath remembers" — the sets
//     of the most recent COMPLETED session for that movement, in any template.
//     Any template, deliberately: the user's bench press history is their bench
//     press history, and scoping it to one workout would reset it every time a
//     program changed.
//
//   • `alsoLogged` is what happens when somebody drops to the short version
//     halfway through. Those sets were really performed; dropping them from the
//     view because the current variant no longer prescribes them would make the
//     app appear to have lost work the user watched it save.
//
// `Decimal` weights become NUMBERS here. Prisma serializes them as strings, and
// a client doing arithmetic on "20.00" gets string concatenation.
// =============================================================================

export type SetLogRow = {
  id: string;
  clientId: string;
  exerciseId: string;
  setNumber: number;
  weightKg: Prisma.Decimal | null;
  reps: number;
  rpe: number | null;
  discomfort: string;
  loggedAt: Date;
};

export type TemplateExerciseRow = {
  order: number;
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  notes: string | null;
  exercise: { name: string; equipment: string[]; instructions: string };
};

export interface SessionViewInput {
  session: {
    id: string;
    status: string;
    variant: string;
    startedAt: Date;
    finishedAt: Date | null;
    discomfortFlag: boolean;
    commitmentId: string | null;
  };
  program: { id: string; name: string; durationWeeks: number; trainingDays: number };
  template: { id: string; name: string; variant: string; targetMinutes: number };
  availableVariants: string[];
  exercises: TemplateExerciseRow[];
  logs: SetLogRow[];
  /** exerciseId → the most recent COMPLETED session's sets for that movement. */
  history: Map<string, { sessionDate: Date; sets: SetLogRow[] }>;
  /** exerciseId → E09-04's suggestion. Empty until that lands. */
  progression?: Map<string, unknown>;
  sessionIndex: number;
}

export function toSetLogDto(row: SetLogRow): SetLogDto {
  return {
    id: row.id,
    clientId: row.clientId,
    exerciseId: row.exerciseId,
    setNumber: row.setNumber,
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    reps: row.reps,
    rpe: row.rpe,
    discomfort: row.discomfort,
    loggedAt: row.loggedAt.toISOString(),
  };
}

const bySetNumber = (a: SetLogRow, b: SetLogRow) => a.setNumber - b.setNumber;

export function buildSessionView(input: SessionViewInput): WorkoutSessionViewDto {
  const prescribed = new Set(input.exercises.map((row) => row.exerciseId));

  const exercises: SessionExerciseDto[] = input.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((row) => {
      const last = input.history.get(row.exerciseId) ?? null;

      return {
        order: row.order,
        exerciseId: row.exerciseId,
        name: row.exercise.name,
        equipment: row.exercise.equipment,
        instructions: row.exercise.instructions,
        sets: row.sets,
        repMin: row.repMin,
        repMax: row.repMax,
        restSeconds: row.restSeconds,
        notes: row.notes,
        lastTime: last
          ? {
              sessionDate: last.sessionDate.toISOString(),
              sets: last.sets.slice().sort(bySetNumber).map(toSetLogDto),
            }
          : null,
        progression: input.progression?.get(row.exerciseId) ?? null,
        logged: input.logs
          .filter((log) => log.exerciseId === row.exerciseId)
          .sort(bySetNumber)
          .map(toSetLogDto),
      };
    });

  return {
    id: input.session.id,
    status: input.session.status,
    variant: input.session.variant,
    templateId: input.template.id,
    templateName: input.template.name,
    startedAt: input.session.startedAt.toISOString(),
    finishedAt: input.session.finishedAt?.toISOString() ?? null,
    discomfortFlag: input.session.discomfortFlag,
    commitmentId: input.session.commitmentId,
    setCount: input.logs.length,
    program: { id: input.program.id, name: input.program.name },
    template: input.template,
    header: {
      title: input.template.name,
      sessionIndex: input.sessionIndex,
      // The whole program, in sessions. `durationWeeks × training days` rather
      // than a stored counter: a counter would need updating whenever the week
      // changed, and would be wrong in exactly the case that matters.
      sessionTotal: input.program.durationWeeks * input.program.trainingDays,
    },
    availableVariants: input.availableVariants,
    exercises,
    alsoLogged: input.logs
      .filter((log) => !prescribed.has(log.exerciseId))
      .sort(bySetNumber)
      .map(toSetLogDto),
    // Once flagged, it stays visible for the rest of the session: the user who
    // reported sharp pain on set two should still see it on set five.
    safety: input.session.discomfortFlag ? { copy: PAIN_SAFETY_COPY } : null,
  };
}
