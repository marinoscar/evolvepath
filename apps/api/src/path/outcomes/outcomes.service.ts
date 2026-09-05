import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../owned-resource';
import { CreateOutcomeDto } from './dto/create-outcome.dto';
import { UpdateOutcomeDto } from './dto/update-outcome.dto';
import { OutcomeQueryDto } from './dto/outcome-query.dto';
import { OutcomeResponseDto } from './dto/outcome-response.dto';

/**
 * Every read pulls the plan and its ACTIVE version, because the two questions
 * the Path screen asks of an outcome — "does it have a plan?" and "which
 * version is live?" — would otherwise be N+1 round trips per card.
 */
const OUTCOME_INCLUDE = {
  plan: {
    select: {
      id: true,
      versions: {
        where: { status: 'ACTIVE' as const },
        select: { id: true, version: true },
        take: 1,
      },
    },
  },
} satisfies Prisma.OutcomeInclude;

type OutcomeRow = Prisma.OutcomeGetPayload<{ include: typeof OUTCOME_INCLUDE }>;

@Injectable()
export class OutcomesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: OutcomeQueryDto): Promise<OutcomeResponseDto[]> {
    const where: Prisma.OutcomeWhereInput = { userId };

    if (query.domain) {
      where.domain = query.domain;
    }

    if (query.state) {
      // An explicit `state=ARCHIVED` is itself a request to see archived rows;
      // making the caller also pass `includeArchived` would answer an empty
      // list to an unambiguous question.
      where.state = query.state;
    } else if (!query.includeArchived) {
      where.state = { not: 'ARCHIVED' };
    }

    const rows = await this.prisma.outcome.findMany({
      where,
      include: OUTCOME_INCLUDE,
      // Domain groups the Path screen's sections; importance orders the cards
      // inside one; createdAt breaks the tie so the order is stable across
      // reloads rather than whatever Postgres returns.
      orderBy: [{ domain: 'asc' }, { importance: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => this.toDto(row));
  }

  async create(userId: string, dto: CreateOutcomeDto): Promise<OutcomeResponseDto> {
    const row = await this.prisma.outcome.create({
      data: {
        userId,
        domain: dto.domain,
        title: dto.title,
        description: dto.description ?? null,
        targetDate: dto.targetDate ? new Date(`${dto.targetDate}T00:00:00.000Z`) : null,
        importance: dto.importance,
        motivation: dto.motivation ?? null,
        successDefinition: dto.successDefinition ?? null,
        userConfidence: dto.userConfidence ?? null,
      },
      include: OUTCOME_INCLUDE,
    });

    await this.audit(userId, 'outcome:create', row.id, {
      domain: row.domain,
      importance: row.importance,
    });

    return this.toDto(row);
  }

  async get(userId: string, id: string): Promise<OutcomeResponseDto> {
    return this.toDto(await this.findOwned(userId, id));
  }

  async update(userId: string, id: string, dto: UpdateOutcomeDto): Promise<OutcomeResponseDto> {
    const existing = await this.findOwned(userId, id);

    if (existing.state === 'ARCHIVED') {
      // 409 rather than a silent unarchive: the user archived this deliberately
      // and an edit is not the gesture that should bring it back.
      throw new ConflictException('Outcome is archived');
    }

    const data: Prisma.OutcomeUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.targetDate !== undefined) {
      data.targetDate = dto.targetDate ? new Date(`${dto.targetDate}T00:00:00.000Z`) : null;
    }
    if (dto.importance !== undefined) data.importance = dto.importance;
    if (dto.motivation !== undefined) data.motivation = dto.motivation ?? null;
    if (dto.successDefinition !== undefined) data.successDefinition = dto.successDefinition ?? null;
    if (dto.userConfidence !== undefined) data.userConfidence = dto.userConfidence ?? null;
    if (dto.state !== undefined) data.state = dto.state;

    const row = await this.prisma.outcome.update({
      where: { id },
      data,
      include: OUTCOME_INCLUDE,
    });

    await this.audit(userId, 'outcome:update', row.id, { changed: Object.keys(data) });

    return this.toDto(row);
  }

  /**
   * Idempotent: archiving an already-archived outcome answers 200 and writes
   * nothing, so a double-tap on a phone does not produce two audit rows and
   * does not move `archivedAt` forward.
   */
  async archive(userId: string, id: string): Promise<OutcomeResponseDto> {
    const existing = await this.findOwned(userId, id);

    if (existing.state === 'ARCHIVED') {
      return this.toDto(existing);
    }

    const row = await this.prisma.outcome.update({
      where: { id },
      data: { state: 'ARCHIVED', archivedAt: new Date() },
      include: OUTCOME_INCLUDE,
    });

    await this.audit(userId, 'outcome:archive', row.id, { domain: row.domain });

    return this.toDto(row);
  }

  /**
   * The ownership-scoped lookup every other public method starts from.
   * Exported behaviour, not a convenience: #42 resolves an outcome the same
   * way before creating its plan.
   */
  async findOwned(userId: string, id: string): Promise<OutcomeRow> {
    return findOwnedOrThrow(
      () => this.prisma.outcome.findFirst({ where: { id, userId }, include: OUTCOME_INCLUDE }),
      'Outcome',
    );
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'outcome', targetId, meta },
    });
  }

  private toDto(row: OutcomeRow): OutcomeResponseDto {
    const activeVersion = row.plan?.versions[0] ?? null;

    return {
      id: row.id,
      domain: row.domain,
      title: row.title,
      description: row.description,
      // @db.Date comes back as UTC midnight; the date part is the whole value.
      targetDate: row.targetDate ? row.targetDate.toISOString().slice(0, 10) : null,
      importance: row.importance,
      motivation: row.motivation,
      state: row.state,
      successDefinition: row.successDefinition,
      userConfidence: row.userConfidence,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      planId: row.plan?.id ?? null,
      activePlanVersion: activeVersion
        ? { id: activeVersion.id, version: activeVersion.version }
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
