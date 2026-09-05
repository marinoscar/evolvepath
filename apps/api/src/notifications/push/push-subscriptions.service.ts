import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { hostOf } from '../channels/push-notification.channel';
import type {
  CreatePushSubscriptionDto,
  PushSubscriptionSummary,
} from './dto/push-subscription.dto';

@Injectable()
export class PushSubscriptionsService {
  private readonly logger = new Logger(PushSubscriptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<PushSubscriptionSummary[]> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      // The host, never the endpoint — see the DTO for why.
      endpointHost: hostOf(row.endpoint),
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    }));
  }

  /**
   * Upsert on the endpoint, RE-OWNING it if it belonged to someone else.
   *
   * This is the shared-device case and it has to work: one browser profile,
   * signed out and signed in as somebody else. The endpoint is a property of
   * the browser, not of the account, so the account that most recently proved
   * it controls that browser is the one that should receive its notifications.
   * Keeping the old row instead would send the previous user's coaching to a
   * device they no longer have — which is the failure mode the unique index on
   * `endpoint` exists to make impossible.
   */
  async upsert(
    userId: string,
    dto: CreatePushSubscriptionDto,
  ): Promise<{ id: string }> {
    const data: Prisma.PushSubscriptionUncheckedCreateInput = {
      userId,
      endpoint: dto.endpoint,
      keys: dto.keys,
      userAgent: dto.userAgent ?? null,
    };

    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: data,
      update: {
        userId,
        keys: dto.keys,
        userAgent: dto.userAgent ?? null,
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });

    this.logger.log(
      `push subscription added user=${userId} host=${hostOf(dto.endpoint)}`,
    );
    return row;
  }

  /** Idempotent, and scoped to the caller's own rows. */
  async remove(userId: string, endpoint: string): Promise<void> {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });

    if (count > 0) {
      this.logger.log(
        `push subscription removed user=${userId} host=${hostOf(endpoint)}`,
      );
    }
  }
}
