import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { findOwnedOrThrow } from '../path/owned-resource';

export interface ConversationDto {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string;
}

/**
 * Conversations, and nothing else.
 *
 * Split from `CoachService` because a thread is a container the user owns and
 * can delete (PRD §84), while a turn is an orchestration involving safety, the
 * assembler, the gateway and the proposal protocol. Keeping them apart is what
 * lets the delete route and the list route stay boring.
 */
@Injectable()
export class CoachConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, title?: string | null): Promise<ConversationDto> {
    const row = await this.prisma.coachConversation.create({
      data: { userId, title: title?.trim() ? title.trim().slice(0, 120) : null },
    });

    return toDto(row);
  }

  async list(
    userId: string,
    { limit = 20, cursor }: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: ConversationDto[]; nextCursor: string | null }> {
    const take = Math.min(Math.max(limit, 1), 50);

    const rows = await this.prisma.coachConversation.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const items = rows.slice(0, take);

    return {
      items: items.map(toDto),
      nextCursor: rows.length > take ? items[items.length - 1].id : null,
    };
  }

  /** 404 for a conversation that is not yours — never 403. */
  async findOwned(userId: string, id: string) {
    return findOwnedOrThrow(
      () => this.prisma.coachConversation.findFirst({ where: { id, userId } }),
      'Conversation',
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    const conversation = await this.findOwned(userId, id);

    // Messages cascade. A proposal created from one of them does NOT — its
    // `sourceMessageId` goes null and the record of the plan change stands.
    await this.prisma.coachConversation.delete({ where: { id: conversation.id } });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'coach:conversation_deleted',
        targetType: 'coach_conversation',
        targetId: id,
        meta: {} as Prisma.InputJsonValue,
      },
    });
  }
}

function toDto(row: {
  id: string;
  title: string | null;
  createdAt: Date;
  lastMessageAt: Date;
}): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}
