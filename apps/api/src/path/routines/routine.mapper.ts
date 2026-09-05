import type { Routine } from '@prisma/client';

import { RoutineResponseDto } from './dto/routine-response.dto';

/**
 * One mapper, used by both `RoutinesService` and `PlanVersionsService`.
 * A routine rendered inside a version and a routine rendered on its own are
 * the same object; two mappers would be two chances to disagree.
 */
export function toRoutineDto(routine: Routine): RoutineResponseDto {
  return {
    id: routine.id,
    planVersionId: routine.planVersionId,
    title: routine.title,
    domain: routine.domain,
    triggerType: routine.triggerType,
    triggerValue: routine.triggerValue,
    frequency: routine.frequency,
    daysOfWeek: routine.daysOfWeek,
    preferredTime: routine.preferredTime,
    estimatedDurationMin: routine.estimatedDurationMin,
    minimumDurationMin: routine.minimumDurationMin,
    fallbackBehavior: routine.fallbackBehavior,
    active: routine.active,
    sortOrder: routine.sortOrder,
    createdAt: routine.createdAt.toISOString(),
    updatedAt: routine.updatedAt.toISOString(),
  };
}

/** Routines render in the order the user arranged them, ties broken by age. */
export const ROUTINE_ORDER = [
  { sortOrder: 'asc' as const },
  { createdAt: 'asc' as const },
];
