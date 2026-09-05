import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma, PlanVersion } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../owned-resource';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { RoutineQueryDto } from './dto/routine-query.dto';
import { RoutineResponseDto } from './dto/routine-response.dto';
import { ROUTINE_ORDER, toRoutineDto } from './routine.mapper';

/** The two states in which a version's behaviours may still be changed. */
const EDITABLE_STATUSES = new Set(['DRAFT', 'ACTIVE']);

@Injectable()
export class RoutinesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: RoutineQueryDto): Promise<RoutineResponseDto[]> {
    await this.findOwnedVersion(userId, query.planVersionId);

    const where: Prisma.RoutineWhereInput = { userId, planVersionId: query.planVersionId };
    if (!query.includeInactive) {
      where.active = true;
    }

    const routines = await this.prisma.routine.findMany({ where, orderBy: ROUTINE_ORDER });

    return routines.map(toRoutineDto);
  }

  async create(userId: string, dto: CreateRoutineDto): Promise<RoutineResponseDto> {
    const version = await this.findOwnedVersion(userId, dto.planVersionId);
    this.assertVersionEditable(version);

    // The domain defaults to the outcome's, reached through the version's plan.
    const domain =
      dto.domain ??
      (
        await this.prisma.plan.findUniqueOrThrow({
          where: { id: version.planId },
          select: { outcome: { select: { domain: true } } },
        })
      ).outcome.domain;

    const routine = await this.prisma.routine.create({
      data: {
        // ALWAYS the caller. A `userId` in the body would let one user file a
        // routine under another's version.
        userId,
        planVersionId: dto.planVersionId,
        title: dto.title,
        domain,
        triggerType: dto.triggerType,
        triggerValue: dto.triggerValue ?? null,
        frequency: dto.frequency,
        daysOfWeek: dto.daysOfWeek,
        preferredTime: dto.preferredTime ?? null,
        estimatedDurationMin: dto.estimatedDurationMin,
        minimumDurationMin: dto.minimumDurationMin,
        fallbackBehavior: dto.fallbackBehavior ?? null,
        sortOrder: dto.sortOrder,
      },
    });

    await this.audit(userId, 'routine:create', routine.id, {
      planVersionId: routine.planVersionId,
      domain: routine.domain,
      frequency: routine.frequency,
    });

    return toRoutineDto(routine);
  }

  async get(userId: string, id: string): Promise<RoutineResponseDto> {
    return toRoutineDto(await this.findOwned(userId, id));
  }

  async update(userId: string, id: string, dto: UpdateRoutineDto): Promise<RoutineResponseDto> {
    const existing = await this.findOwned(userId, id);
    const version = await this.findOwnedVersion(userId, existing.planVersionId);
    this.assertVersionEditable(version);

    const data: Prisma.RoutineUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.domain !== undefined) data.domain = dto.domain;
    if (dto.triggerType !== undefined) data.triggerType = dto.triggerType;
    if (dto.triggerValue !== undefined) data.triggerValue = dto.triggerValue ?? null;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.daysOfWeek !== undefined) data.daysOfWeek = dto.daysOfWeek;
    if (dto.preferredTime !== undefined) data.preferredTime = dto.preferredTime ?? null;
    if (dto.estimatedDurationMin !== undefined) data.estimatedDurationMin = dto.estimatedDurationMin;
    if (dto.minimumDurationMin !== undefined) data.minimumDurationMin = dto.minimumDurationMin;
    if (dto.fallbackBehavior !== undefined) data.fallbackBehavior = dto.fallbackBehavior ?? null;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    // The cross-field rules run against the MERGED routine, not the patch: a
    // PATCH setting only `minimumDurationMin: 90` on a 45-minute routine is
    // invalid, and the DTO alone cannot see that.
    this.assertMergedRoutineValid({ ...existing, ...data } as typeof existing);

    const routine = await this.prisma.routine.update({ where: { id }, data });

    await this.audit(userId, 'routine:update', id, { changed: Object.keys(data) });

    return toRoutineDto(routine);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.findOwned(userId, id);
    const version = await this.findOwnedVersion(userId, existing.planVersionId);
    this.assertVersionEditable(version);

    await this.prisma.routine.delete({ where: { id } });

    await this.audit(userId, 'routine:delete', id, { planVersionId: existing.planVersionId });
  }

  private async findOwned(userId: string, id: string) {
    return findOwnedOrThrow(
      () => this.prisma.routine.findFirst({ where: { id, userId } }),
      'Routine',
    );
  }

  /** Ownership of a version is the gate on everything a routine can do. */
  private async findOwnedVersion(userId: string, planVersionId: string): Promise<PlanVersion> {
    return findOwnedOrThrow(
      () => this.prisma.planVersion.findFirst({ where: { id: planVersionId, userId } }),
      'Plan version',
    );
  }

  /**
   * A SUPERSEDED or REJECTED version is history. Its routines are the record
   * of what the plan used to say, and editing them makes "why did this change?"
   * unanswerable — the before side of the change would silently become the
   * after side.
   */
  private assertVersionEditable(version: PlanVersion): void {
    if (!EDITABLE_STATUSES.has(version.status)) {
      throw new ConflictException(
        `Plan version v${version.version} is ${version.status} and is read-only`,
      );
    }
  }

  private assertMergedRoutineValid(routine: {
    triggerType: string;
    triggerValue: string | null;
    frequency: string;
    daysOfWeek: number[];
    estimatedDurationMin: number;
    minimumDurationMin: number;
  }): void {
    if (routine.triggerType === 'EVENT' && !routine.triggerValue?.trim()) {
      throw new ConflictException('An EVENT trigger requires the event that starts it');
    }

    if (routine.triggerType === 'TIME' && routine.triggerValue != null) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(routine.triggerValue)) {
        throw new ConflictException('A TIME trigger must be HH:mm');
      }
    }

    if (routine.frequency === 'CUSTOM' && routine.daysOfWeek.length === 0) {
      throw new ConflictException('A CUSTOM frequency requires at least one day');
    }

    if (routine.frequency !== 'CUSTOM' && routine.daysOfWeek.length > 0) {
      throw new ConflictException('daysOfWeek applies only to a CUSTOM frequency');
    }

    if (routine.minimumDurationMin > routine.estimatedDurationMin) {
      throw new ConflictException('The minimum version cannot be longer than the full one');
    }
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'routine', targetId, meta },
    });
  }
}
