import { Injectable } from '@nestjs/common';
import type { BestSelfProfile, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UpsertBestSelfDto } from './dto/upsert-best-self.dto';
import { BestSelfResponseDto } from './dto/best-self-response.dto';

/** The fields whose presence the audit row records — never their contents. */
const AUDITED_FIELDS = [
  'identityStatement',
  'workIdentity',
  'familyIdentity',
  'healthIdentity',
  'sixMonthVision',
  'motivations',
  'reasons',
] as const;

@Injectable()
export class BestSelfService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<BestSelfResponseDto | null> {
    const profile = await this.prisma.bestSelfProfile.findUnique({ where: { userId } });

    return profile ? this.toDto(profile) : null;
  }

  /**
   * Replaces the profile whole. There is deliberately no PATCH: a Best Self
   * statement is one thought, and a half-updated one ("I am a present father"
   * beside last month's health identity) is not a state the user asked for.
   */
  async upsert(userId: string, dto: UpsertBestSelfDto): Promise<BestSelfResponseDto> {
    const now = new Date();

    const data = {
      identityStatement: dto.identityStatement ?? null,
      workIdentity: dto.workIdentity ?? null,
      familyIdentity: dto.familyIdentity ?? null,
      healthIdentity: dto.healthIdentity ?? null,
      sixMonthVision: dto.sixMonthVision ?? null,
      motivations: dto.motivations,
      reasons: dto.reasons,
      lastReviewedAt: now,
    };

    const profile = await this.prisma.bestSelfProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'best_self:replace',
        targetType: 'best_self_profile',
        targetId: profile.id,
        // FIELD NAMES ONLY. `audit_events` is readable by administrators, and
        // an identity statement is the most personal sentence in this product.
        // What is auditable is that the user replaced their profile and which
        // parts of it they filled in — never a word of what they wrote.
        meta: { fields: this.presentFields(data) } as Prisma.InputJsonValue,
      },
    });

    return this.toDto(profile);
  }

  private presentFields(data: Record<string, unknown>): string[] {
    return AUDITED_FIELDS.filter((field) => {
      const value = data[field];
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
    });
  }

  private toDto(profile: BestSelfProfile): BestSelfResponseDto {
    return {
      id: profile.id,
      identityStatement: profile.identityStatement,
      workIdentity: profile.workIdentity,
      familyIdentity: profile.familyIdentity,
      healthIdentity: profile.healthIdentity,
      sixMonthVision: profile.sixMonthVision,
      motivations: profile.motivations,
      reasons: profile.reasons,
      lastReviewedAt: profile.lastReviewedAt ? profile.lastReviewedAt.toISOString() : null,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
