import type { Prisma } from '@prisma/client';

import type {
  WeeklyStructureEntryDto,
  WorkoutProgramDto,
  WorkoutProgramSummaryDto,
} from '../dto/workout-program.dtos';
import { programSubstitutionsSchema, weeklyStructureSchema } from './workout-program.schema';

/** Everything a program screen renders, in one query. */
export const PROGRAM_INCLUDE = {
  templates: {
    include: {
      exercises: {
        include: { exercise: { select: { id: true, name: true } } },
        orderBy: { order: 'asc' as const },
      },
    },
  },
} satisfies Prisma.WorkoutProgramInclude;

export type ProgramRow = Prisma.WorkoutProgramGetPayload<{ include: typeof PROGRAM_INCLUDE }>;

/** FULL first, then its two fallbacks, then the next workout. */
const VARIANT_ORDER = { FULL: 0, SHORT: 1, MINIMUM: 2 } as const;

function weeklyStructureOf(value: Prisma.JsonValue): WeeklyStructureEntryDto[] {
  const parsed = weeklyStructureSchema.safeParse(value);

  // A row whose JSON no longer parses is a schema change we shipped, not a user
  // error: report an empty week rather than 500-ing the whole program list.
  return parsed.success ? parsed.data : [];
}

export function toProgramSummary(row: {
  id: string;
  name: string;
  status: string;
  durationWeeks: number;
  weeklyStructure: Prisma.JsonValue;
  planId: string | null;
  createdAt: Date;
}): WorkoutProgramSummaryDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    durationWeeks: row.durationWeeks,
    weeklyStructure: weeklyStructureOf(row.weeklyStructure),
    planId: row.planId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toProgramDto(row: ProgramRow): WorkoutProgramDto {
  const substitutions = programSubstitutionsSchema.safeParse(row.substitutions);

  return {
    ...toProgramSummary(row),
    rationale: row.rationale,
    substitutions: substitutions.success ? substitutions.data : [],
    templates: [...row.templates]
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant],
      )
      .map((template) => ({
        id: template.id,
        name: template.name,
        variant: template.variant,
        targetMinutes: template.targetMinutes,
        routineId: template.routineId,
        exercises: template.exercises.map((item) => ({
          id: item.id,
          exerciseId: item.exerciseId,
          name: item.exercise.name,
          order: item.order,
          sets: item.sets,
          repMin: item.repMin,
          repMax: item.repMax,
          restSeconds: item.restSeconds,
          notes: item.notes,
        })),
      })),
  };
}
