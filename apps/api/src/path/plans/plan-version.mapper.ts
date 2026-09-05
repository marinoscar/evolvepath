import type { PlanVersion, Routine } from '@prisma/client';

import { PlanVersionSummaryDto } from './dto/plan-response.dto';
import { PlanVersionResponseDto } from './dto/plan-version-response.dto';
import { toRoutineDto } from '../routines/routine.mapper';

export type PlanVersionWithRoutines = PlanVersion & { routines: Routine[] };
export type PlanVersionWithCount = PlanVersion & { _count: { routines: number } };

export function toPlanVersionSummary(
  version: PlanVersion,
  routineCount: number,
): PlanVersionSummaryDto {
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    rationale: version.rationale,
    createdBy: version.createdBy,
    userApproved: version.userApproved,
    previousVersionId: version.previousVersionId,
    activeFrom: version.activeFrom ? version.activeFrom.toISOString() : null,
    activeUntil: version.activeUntil ? version.activeUntil.toISOString() : null,
    routineCount,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toPlanVersionDto(version: PlanVersionWithRoutines): PlanVersionResponseDto {
  return {
    ...toPlanVersionSummary(version, version.routines.length),
    planId: version.planId,
    expectedWeeklyLoad: version.expectedWeeklyLoad,
    fallbackStrategy: version.fallbackStrategy,
    routines: version.routines.map(toRoutineDto),
  };
}
