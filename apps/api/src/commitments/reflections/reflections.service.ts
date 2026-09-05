import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { CreateReflectionDto } from './dto/create-reflection.dto';
import { ReflectionQueryDto } from './dto/reflection-query.dto';
import { ReflectionResponseDto } from './dto/reflection-response.dto';
import { toReflectionDto } from './reflection.mapper';

/** A listing is a sidebar, not an export. */
const MAX_REFLECTIONS = 200;

@Injectable()
export class ReflectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ReflectionQueryDto): Promise<ReflectionResponseDto[]> {
    const where: Prisma.ReflectionWhereInput = { userId };

    if (query.relatedType) where.relatedType = query.relatedType;
    if (query.relatedId) where.relatedId = query.relatedId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const rows = await this.prisma.reflection.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_REFLECTIONS,
    });

    return rows.map(toReflectionDto);
  }

  async create(userId: string, dto: CreateReflectionDto): Promise<ReflectionResponseDto> {
    // `relatedId` is a soft pointer, so nothing in the database checks it. The
    // check has to be here, per type, or a user could attach a reflection to
    // another user's outcome and read its id back.
    if (dto.relatedId) {
      await this.assertRelatedOwned(userId, dto.relatedType, dto.relatedId);
    }

    const row = await this.prisma.reflection.create({
      data: {
        userId,
        relatedType: dto.relatedType,
        relatedId: dto.relatedId ?? null,
        // Denormalised so the common join is a real foreign key that keeps its
        // SetNull behaviour with the rest of the history.
        commitmentId: dto.relatedType === 'commitment' ? (dto.relatedId ?? null) : null,
        userText: dto.userText ?? null,
        frictionTags: dto.frictionTags,
        mood: dto.mood ?? null,
        perceivedDifficulty: dto.perceivedDifficulty ?? null,
        satisfaction: dto.satisfaction ?? null,
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'reflection:create',
        targetType: 'reflection',
        targetId: row.id,
        // The related row and its type, never the note itself.
        meta: { relatedType: row.relatedType, relatedId: row.relatedId } as Prisma.InputJsonValue,
      },
    });

    return toReflectionDto(row);
  }

  private async assertRelatedOwned(
    userId: string,
    relatedType: string,
    relatedId: string,
  ): Promise<void> {
    switch (relatedType) {
      case 'commitment':
        await findOwnedOrThrow(
          () =>
            this.prisma.commitment.findFirst({ where: { id: relatedId, userId }, select: { id: true } }),
          'Commitment',
        );
        return;
      case 'outcome':
        await findOwnedOrThrow(
          () =>
            this.prisma.outcome.findFirst({ where: { id: relatedId, userId }, select: { id: true } }),
          'Outcome',
        );
        return;
      case 'plan_version':
        await findOwnedOrThrow(
          () =>
            this.prisma.planVersion.findFirst({
              where: { id: relatedId, userId },
              select: { id: true },
            }),
          'Plan version',
        );
        return;
      default:
        // 'day' carries no relatedId to check; the DTO already rejects a
        // relatedId-less commitment/outcome/plan_version.
        return;
    }
  }
}
