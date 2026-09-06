import { Injectable } from '@nestjs/common';
import type { EvidenceSource, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { EvidenceQueryDto } from './dto/evidence-query.dto';
import { EvidenceResponseDto } from './dto/evidence-response.dto';
import { toEvidenceDto } from './evidence.mapper';
import { ActivityTrackerService } from '../../progress/comeback/activity-tracker.service';

/** What a server-side flow supplies. Deliberately not a request shape. */
export interface FlowEvidenceInput {
  commitmentId?: string | null;
  evidenceType: string;
  source: EvidenceSource;
  occurredAt?: Date;
  quantitativeValue?: number | null;
  quantitativeUnit?: string | null;
  qualitativeValue?: string | null;
  confidence?: number | null;
}

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityTrackerService,
  ) {}

  async list(userId: string, query: EvidenceQueryDto): Promise<EvidenceResponseDto[]> {
    const where: Prisma.EvidenceWhereInput = {
      userId,
      occurredAt: { gte: new Date(query.from), lte: new Date(query.to) },
    };

    if (query.commitmentId) where.commitmentId = query.commitmentId;
    if (query.source) where.source = query.source as EvidenceSource;
    // Filtering by domain goes through the commitment, so unattached evidence
    // is excluded — it has no domain to match.
    if (query.domain) where.commitment = { domain: query.domain };

    const rows = await this.prisma.evidence.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
    });

    return rows.map(toEvidenceDto);
  }

  async create(userId: string, dto: CreateEvidenceDto): Promise<EvidenceResponseDto> {
    if (dto.commitmentId) {
      await findOwnedOrThrow(
        () =>
          this.prisma.commitment.findFirst({
            where: { id: dto.commitmentId as string, userId },
            select: { id: true },
          }),
        'Commitment',
      );
    }

    const row = await this.prisma.evidence.create({
      data: {
        userId,
        commitmentId: dto.commitmentId ?? null,
        evidenceType: dto.evidenceType,
        // The DTO's literal already guarantees this; naming it here means a
        // future widening of the DTO cannot silently widen the write.
        source: 'USER_LOG',
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        quantitativeValue: dto.quantitativeValue ?? null,
        quantitativeUnit: dto.quantitativeUnit ?? null,
        qualitativeValue: dto.qualitativeValue ?? null,
        confidence: dto.confidence ?? null,
      },
    });

    await this.audit(userId, 'evidence:create', row.id, {
      source: row.source,
      evidenceType: row.evidenceType,
      commitmentId: row.commitmentId,
    });

    // Logging what happened is the purest form of activity (#112).
    this.activity.record(userId);

    return toEvidenceDto(row);
  }

  /**
   * The entry point for server-side flows that observe something: the Start
   * flow's TIMER rows (E05), focus sessions (E07), the workout runner (E09).
   *
   * ON NO ROUTE, and that is the whole point. `TIMER`, `WORKOUT_LOG` and
   * `APP_FLOW` mean "the system saw this happen"; a client able to write them
   * could manufacture observations, which is exactly what PRD §10.9's "the
   * product should not pretend planned events are completion evidence" is
   * about. The request DTO's `source` is a literal for the same reason.
   */
  async createFromFlow(userId: string, input: FlowEvidenceInput): Promise<EvidenceResponseDto> {
    const row = await this.prisma.evidence.create({
      data: {
        userId,
        commitmentId: input.commitmentId ?? null,
        evidenceType: input.evidenceType,
        source: input.source,
        occurredAt: input.occurredAt ?? new Date(),
        quantitativeValue: input.quantitativeValue ?? null,
        quantitativeUnit: input.quantitativeUnit ?? null,
        qualitativeValue: input.qualitativeValue ?? null,
        confidence: input.confidence ?? null,
      },
    });

    await this.audit(userId, 'evidence:create', row.id, {
      source: row.source,
      evidenceType: row.evidenceType,
      commitmentId: row.commitmentId,
    });

    // Logging what happened is the purest form of activity (#112).
    this.activity.record(userId);

    return toEvidenceDto(row);
  }

  /** PRD §127: the user controls their own record, including deleting it. */
  async remove(userId: string, id: string): Promise<void> {
    const existing = await findOwnedOrThrow(
      () => this.prisma.evidence.findFirst({ where: { id, userId } }),
      'Evidence',
    );

    await this.prisma.evidence.delete({ where: { id: existing.id } });

    await this.audit(userId, 'evidence:delete', id, {
      source: existing.source,
      commitmentId: existing.commitmentId,
    });
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'evidence', targetId, meta },
    });
  }
}
