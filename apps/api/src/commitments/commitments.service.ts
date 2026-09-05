import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type CommitmentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { findOwnedOrThrow } from '../path/owned-resource';
import { canTransition, TERMINAL_STATUSES } from './commitment-transitions';
import { CreateCommitmentDto } from './dto/create-commitment.dto';
import { UpdateCommitmentDto } from './dto/update-commitment.dto';
import { CommitmentQueryDto } from './dto/commitment-query.dto';
import { TransitionCommitmentDto } from './dto/transition-commitment.dto';
import {
  CommitmentDetailDto,
  CommitmentResponseDto,
  TransitionResultDto,
} from './dto/commitment-response.dto';
import { toCommitmentDto } from './commitment.mapper';
import { toEvidenceDto } from './evidence/evidence.mapper';
import { toReflectionDto } from './reflections/reflection.mapper';

const LIST_INCLUDE = {
  _count: { select: { evidence: true } },
  rescheduledTo: { select: { id: true }, take: 1 },
} satisfies Prisma.CommitmentInclude;

@Injectable()
export class CommitmentsService {
  private readonly logger = new Logger(CommitmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: CommitmentQueryDto): Promise<CommitmentResponseDto[]> {
    const where: Prisma.CommitmentWhereInput = {
      userId,
      scheduledStart: { gte: new Date(query.from), lte: new Date(query.to) },
    };

    if (query.domain) where.domain = query.domain;
    if (query.status) where.status = { in: query.status as CommitmentStatus[] };
    if (query.outcomeId) where.outcomeId = query.outcomeId;
    if (query.planVersionId) where.planVersionId = query.planVersionId;

    const rows = await this.prisma.commitment.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { scheduledStart: 'asc' },
    });

    return rows.map(toCommitmentDto);
  }

  async create(userId: string, dto: CreateCommitmentDto): Promise<CommitmentResponseDto> {
    await this.assertLinksOwnedAndConsistent(userId, dto);

    const row = await this.prisma.commitment.create({
      data: {
        userId,
        domain: dto.domain,
        title: dto.title,
        outcomeId: dto.outcomeId ?? null,
        planVersionId: dto.planVersionId ?? null,
        routineId: dto.routineId ?? null,
        scheduledStart: new Date(dto.scheduledStart),
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : null,
        importance: dto.importance,
        commitmentType: dto.commitmentType ?? null,
        fullVersion: dto.fullVersion ?? null,
        shortVersion: dto.shortVersion ?? null,
        minimumVersion: dto.minimumVersion ?? null,
        userConfirmed: dto.userConfirmed,
      },
      include: LIST_INCLUDE,
    });

    // NO EVIDENCE ROW. Creating a commitment is a plan, and PRD §10.9 is
    // explicit that the product must not pretend a planned item is evidence
    // that anything happened.
    await this.audit(userId, 'commitment:create', row.id, {
      domain: row.domain,
      planVersionId: row.planVersionId,
      routineId: row.routineId,
      rescheduledFromId: row.rescheduledFromId,
    });

    return toCommitmentDto(row);
  }

  async get(userId: string, id: string): Promise<CommitmentDetailDto> {
    const row = await findOwnedOrThrow(
      () =>
        this.prisma.commitment.findFirst({
          where: { id, userId },
          include: {
            ...LIST_INCLUDE,
            evidence: { orderBy: { occurredAt: 'desc' } },
            reflections: { orderBy: { createdAt: 'desc' } },
          },
        }),
      'Commitment',
    );

    return {
      ...toCommitmentDto(row),
      evidence: row.evidence.map(toEvidenceDto),
      reflections: row.reflections.map(toReflectionDto),
    };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCommitmentDto,
  ): Promise<CommitmentResponseDto> {
    const existing = await this.findOwned(userId, id);

    // A finished commitment is a record of a day that already happened.
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictException(`A ${existing.status} commitment cannot be edited`);
    }

    const data: Prisma.CommitmentUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.scheduledStart !== undefined) data.scheduledStart = new Date(dto.scheduledStart);
    if (dto.scheduledEnd !== undefined) {
      data.scheduledEnd = dto.scheduledEnd ? new Date(dto.scheduledEnd) : null;
    }
    if (dto.importance !== undefined) data.importance = dto.importance;
    if (dto.commitmentType !== undefined) data.commitmentType = dto.commitmentType ?? null;
    if (dto.fullVersion !== undefined) data.fullVersion = dto.fullVersion ?? null;
    if (dto.shortVersion !== undefined) data.shortVersion = dto.shortVersion ?? null;
    if (dto.minimumVersion !== undefined) data.minimumVersion = dto.minimumVersion ?? null;
    if (dto.userConfirmed !== undefined) data.userConfirmed = dto.userConfirmed;

    // The merged schedule, not just the patch: moving only the start past an
    // unchanged end is invalid and the DTO cannot see it.
    const start = (data.scheduledStart as Date | undefined) ?? existing.scheduledStart;
    const end =
      dto.scheduledEnd !== undefined
        ? (data.scheduledEnd as Date | null)
        : existing.scheduledEnd;
    if (end && end <= start) {
      throw new ConflictException('scheduledEnd must be after scheduledStart');
    }

    const row = await this.prisma.commitment.update({
      where: { id },
      data,
      include: LIST_INCLUDE,
    });

    await this.audit(userId, 'commitment:update', id, { changed: Object.keys(data) });

    return toCommitmentDto(row);
  }

  /**
   * The one way a commitment's status changes.
   *
   * Everything the transition implies — the timestamps, the evidence row the
   * user chose to log, the replacement commitment a reschedule opens — happens
   * in one transaction, so a reschedule can never leave the original closed
   * with nothing opened in its place. The audit row is written after commit.
   */
  async transition(
    userId: string,
    id: string,
    dto: TransitionCommitmentDto,
  ): Promise<TransitionResultDto> {
    const existing = await this.findOwned(userId, id);
    const from = existing.status;
    const to = dto.to as CommitmentStatus;

    if (!canTransition(from, to)) {
      // `code` in this API is derived from the HTTP status and is a closed
      // enum (see http-exception.filter.ts), so the machine-readable
      // discriminator goes in `details` — the envelope's published slot for
      // exactly this. A client reads `details.reason === 'INVALID_TRANSITION'`.
      throw new ConflictException({
        message: `Cannot move a ${from} commitment to ${to}`,
        details: { reason: 'INVALID_TRANSITION', from, to },
      });
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.CommitmentUpdateInput = { status: to };

      // First time only: a second start would rewrite when the user began.
      if (to === 'STARTED' && !existing.startedAt) {
        data.startedAt = now;
      }

      if (to === 'COMPLETED' || to === 'PARTIALLY_COMPLETED') {
        data.completedAt = now;
      }

      if (to === 'SKIPPED') {
        data.skipReason = dto.reason ?? null;
      }

      let replacement = null;

      if (to === 'RESCHEDULED') {
        const start = new Date(dto.rescheduleTo as string);
        const duration = existing.scheduledEnd
          ? existing.scheduledEnd.getTime() - existing.scheduledStart.getTime()
          : null;

        replacement = await tx.commitment.create({
          data: {
            userId,
            domain: existing.domain,
            title: existing.title,
            outcomeId: existing.outcomeId,
            planVersionId: existing.planVersionId,
            routineId: existing.routineId,
            scheduledStart: start,
            scheduledEnd: duration === null ? null : new Date(start.getTime() + duration),
            importance: existing.importance,
            commitmentType: existing.commitmentType,
            fullVersion: existing.fullVersion,
            shortVersion: existing.shortVersion,
            minimumVersion: existing.minimumVersion,
            status: 'PLANNED',
            rescheduledFromId: existing.id,
            // THE COUNT TRAVELS WITH THE INTENTION, not the row. "Moved twice"
            // must be readable on the live commitment, because that is the one
            // E07's avoidance detection looks at; leaving the count behind on
            // the closed row would make every reschedule look like the first.
            rescheduleCount: existing.rescheduleCount + 1,
          },
          include: LIST_INCLUDE,
        });
      }

      let evidence = null;

      if (dto.evidence) {
        evidence = await tx.evidence.create({
          data: {
            userId,
            commitmentId: existing.id,
            evidenceType:
              dto.evidence.evidenceType ?? (to === 'COMPLETED' ? 'completion' : 'partial'),
            // Always USER_LOG through this path — a client cannot claim the
            // system observed something.
            source: 'USER_LOG',
            occurredAt: now,
            quantitativeValue: dto.evidence.quantitativeValue ?? null,
            quantitativeUnit: dto.evidence.quantitativeUnit ?? null,
            qualitativeValue: dto.evidence.qualitativeValue ?? null,
          },
        });
      }

      const commitment = await tx.commitment.update({
        where: { id: existing.id },
        data,
        include: LIST_INCLUDE,
      });

      return { commitment, replacement, evidence };
    });

    this.logger.log(
      `commitment.transition id=${id} from=${from} to=${to} user=${userId}`,
    );

    await this.audit(userId, 'commitment:transition', id, {
      from,
      to,
      rescheduleCount: result.commitment.rescheduleCount,
      rescheduledToId: result.replacement?.id ?? null,
      evidenceId: result.evidence?.id ?? null,
    });

    return {
      commitment: toCommitmentDto(result.commitment),
      rescheduledTo: result.replacement ? toCommitmentDto(result.replacement) : null,
      evidence: result.evidence ? toEvidenceDto(result.evidence) : null,
    };
  }

  async findOwned(userId: string, id: string) {
    return findOwnedOrThrow(
      () => this.prisma.commitment.findFirst({ where: { id, userId } }),
      'Commitment',
    );
  }

  /**
   * Every foreign id on a create is checked against the caller AND against
   * each other. Ownership alone is not enough: a routine the user owns but
   * which belongs to a different plan version would make the commitment's
   * provenance a lie, and E11 reads that provenance.
   */
  private async assertLinksOwnedAndConsistent(
    userId: string,
    dto: CreateCommitmentDto,
  ): Promise<void> {
    const outcome = dto.outcomeId
      ? await findOwnedOrThrow(
          () =>
            this.prisma.outcome.findFirst({
              where: { id: dto.outcomeId as string, userId },
              select: { id: true, plan: { select: { id: true } } },
            }),
          'Outcome',
        )
      : null;

    const version = dto.planVersionId
      ? await findOwnedOrThrow(
          () =>
            this.prisma.planVersion.findFirst({
              where: { id: dto.planVersionId as string, userId },
              select: { id: true, planId: true, status: true },
            }),
          'Plan version',
        )
      : null;

    const routine = dto.routineId
      ? await findOwnedOrThrow(
          () =>
            this.prisma.routine.findFirst({
              where: { id: dto.routineId as string, userId },
              select: { id: true, planVersionId: true },
            }),
          'Routine',
        )
      : null;

    if (version && outcome && outcome.plan?.id !== version.planId) {
      throw new BadRequestException('planVersionId does not belong to that outcome');
    }

    if (routine && version && routine.planVersionId !== version.id) {
      throw new BadRequestException('routineId does not belong to that plan version');
    }

    if (routine && !version) {
      throw new BadRequestException('routineId requires the planVersionId it belongs to');
    }

    // A commitment derived from a superseded plan would be work the user
    // already decided to stop doing.
    if (version && version.status !== 'ACTIVE' && version.status !== 'DRAFT') {
      throw new ConflictException(`Plan version is ${version.status} and cannot take commitments`);
    }
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'commitment', targetId, meta },
    });
  }
}
