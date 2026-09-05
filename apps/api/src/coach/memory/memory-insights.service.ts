import { Injectable } from '@nestjs/common';
import type { MemoryInsight, MemoryInsightCategory, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import type { MemoryInsightDto } from './dto/memory-insight.dto';

// =============================================================================
// What the coach may remember, and who decides (issue #78, epic E06)
// =============================================================================
//
// PRD §17 Tier 3 requires durable preferences that are "inspectable and
// removable"; §85 names the three controls — Edit, Forget, Don't use for
// coaching — and §127 lists "delete memory" outright.
//
// TWO BOOLEANS, TWO QUESTIONS, AND NEITHER IS THE OTHER'S NEGATION.
// `userConfirmed` is "the user says this is true". `doNotUse` is "the user says
// never bring this up". An insight can be both true and forbidden — the most
// obvious case being an accurate observation about something the user does not
// want coaching about — so collapsing them into one flag would force the
// product to guess which the user meant.
//
// FORGET IS A HARD DELETE. Soft-hiding it would leave a row that says something
// about a person who asked for it to be gone, and the audit trail deliberately
// records only the category — never the statement (PRD §86). The user asked us
// to forget it; writing it into an audit table is not forgetting it.
// =============================================================================

@Injectable()
export class MemoryInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    { category, includeDoNotUse = false }: {
      category?: MemoryInsightCategory;
      includeDoNotUse?: boolean;
    } = {},
  ): Promise<MemoryInsightDto[]> {
    const rows = await this.prisma.memoryInsight.findMany({
      where: {
        userId,
        ...(category ? { category } : {}),
        ...(includeDoNotUse ? {} : { doNotUse: false }),
      },
      orderBy: [
        { category: 'asc' },
        { userConfirmed: 'desc' },
        { confidence: 'desc' },
      ],
    });

    return rows.map(toDto);
  }

  async create(
    userId: string,
    input: { category: MemoryInsightCategory; statement: string },
  ): Promise<MemoryInsightDto> {
    const row = await this.prisma.memoryInsight.create({
      data: {
        userId,
        category: input.category,
        statement: input.statement,
        source: 'USER',
        // Something the user typed about themselves is confirmed by having
        // been typed, is as certain as anything here gets, and rests on no
        // evidence we counted.
        userConfirmed: true,
        confidence: 1,
        evidenceCount: 0,
      },
    });

    await this.audit(userId, 'memory_insight:create', row.id, {
      category: row.category,
    });

    return toDto(row);
  }

  async update(
    userId: string,
    id: string,
    statement: string,
  ): Promise<MemoryInsightDto> {
    const existing = await this.findOwned(userId, id);

    const row = await this.prisma.memoryInsight.update({
      where: { id: existing.id },
      data: {
        statement,
        // Editing an AI guess is how a user says "this, but in my words" —
        // which is a confirmation. Leaving it unconfirmed would mean the coach
        // still ignored the sentence the user just wrote.
        userConfirmed: true,
      },
    });

    await this.audit(userId, 'memory_insight:edit', row.id, {
      category: row.category,
      wasSource: existing.source,
    });

    return toDto(row);
  }

  async confirm(userId: string, id: string): Promise<MemoryInsightDto> {
    const existing = await this.findOwned(userId, id);

    const row = await this.prisma.memoryInsight.update({
      where: { id: existing.id },
      data: { userConfirmed: true },
    });

    await this.audit(userId, 'memory_insight:confirm', row.id, {
      category: row.category,
    });

    return toDto(row);
  }

  async setDoNotUse(
    userId: string,
    id: string,
    doNotUse: boolean,
  ): Promise<MemoryInsightDto> {
    const existing = await this.findOwned(userId, id);

    const row = await this.prisma.memoryInsight.update({
      where: { id: existing.id },
      data: { doNotUse },
    });

    await this.audit(userId, 'memory_insight:do_not_use', row.id, {
      category: row.category,
      doNotUse,
    });

    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.findOwned(userId, id);

    await this.prisma.memoryInsight.delete({ where: { id: existing.id } });

    // CATEGORY ONLY. The user asked us to forget the sentence; copying it into
    // an audit row is not forgetting it (PRD §86).
    await this.audit(userId, 'memory_insight:forget', id, {
      category: existing.category,
    });
  }

  /** 404 for an insight that is not yours — never 403. */
  async findOwned(userId: string, id: string): Promise<MemoryInsight> {
    return findOwnedOrThrow(
      () => this.prisma.memoryInsight.findFirst({ where: { id, userId } }),
      'Memory insight',
    );
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'memory_insight',
        targetId,
        meta,
      },
    });
  }
}

export function toDto(row: MemoryInsight): MemoryInsightDto {
  return {
    id: row.id,
    category: row.category,
    statement: row.statement,
    evidenceCount: row.evidenceCount,
    confidence: row.confidence,
    userConfirmed: row.userConfirmed,
    doNotUse: row.doNotUse,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
