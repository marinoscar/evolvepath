import type { Commitment } from '@prisma/client';

import { allowedTransitions } from './commitment-transitions';
import { CommitmentResponseDto } from './dto/commitment-response.dto';

export type CommitmentRow = Commitment & {
  _count?: { evidence: number };
  rescheduledTo?: Array<{ id: string }>;
};

/**
 * `allowedTransitions` is computed here rather than left to the client.
 *
 * The web app has its own copy of the matrix for rendering a menu without a
 * round trip, but the server's answer is the authoritative one — a client
 * running yesterday's bundle would otherwise offer a move this API refuses.
 */
export function toCommitmentDto(row: CommitmentRow): CommitmentResponseDto {
  return {
    id: row.id,
    domain: row.domain,
    title: row.title,
    outcomeId: row.outcomeId,
    planVersionId: row.planVersionId,
    routineId: row.routineId,
    ritualId: row.ritualId,
    familyMemberId: row.familyMemberId,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd ? row.scheduledEnd.toISOString() : null,
    importance: row.importance,
    commitmentType: row.commitmentType,
    fullVersion: row.fullVersion,
    shortVersion: row.shortVersion,
    minimumVersion: row.minimumVersion,
    fullMinutes: row.fullMinutes,
    shortMinutes: row.shortMinutes,
    minimumMinutes: row.minimumMinutes,
    status: row.status,
    allowedTransitions: [...allowedTransitions(row.status)],
    rescheduleCount: row.rescheduleCount,
    rescheduledFromId: row.rescheduledFromId,
    rescheduledToId: row.rescheduledTo?.[0]?.id ?? null,
    skipReason: row.skipReason,
    userConfirmed: row.userConfirmed,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    evidenceCount: row._count?.evidence ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
