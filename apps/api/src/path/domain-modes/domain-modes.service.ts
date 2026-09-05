import { Injectable } from '@nestjs/common';
import type { DomainMode, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DOMAINS, DomainValue } from '../domain.schema';
import { SetDomainModeDto } from './dto/set-domain-mode.dto';
import { DomainModeResponseDto } from './dto/domain-mode-response.dto';

@Injectable()
export class DomainModesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Always three entries, in `DOMAINS` order.
   *
   * A domain the user has never touched has no row, and it is SYNTHESISED here
   * as GROW rather than seeded at sign-up. Seeding would mean every account
   * carries three rows nobody chose, "has the user set a mode?" becomes
   * unanswerable, and a fourth domain later needs a backfill. Absent means
   * default — the same contract the notification preferences use.
   */
  async list(userId: string): Promise<DomainModeResponseDto[]> {
    const rows = await this.prisma.domainMode.findMany({ where: { userId } });
    const byDomain = new Map(rows.map((row) => [row.domain, row]));

    return DOMAINS.map((domain) => {
      const row = byDomain.get(domain);
      return row ? this.toDto(row) : { domain, mode: 'GROW', reason: null, effectiveFrom: null };
    });
  }

  async set(
    userId: string,
    domain: DomainValue,
    dto: SetDomainModeDto,
  ): Promise<DomainModeResponseDto> {
    const existing = await this.prisma.domainMode.findUnique({
      where: { userId_domain: { userId, domain } },
    });

    const from = existing?.mode ?? 'GROW';
    // `effectiveFrom` answers "since when have you been in RECOVER?", so it
    // moves only when the posture actually changes. Re-saving the same mode
    // with a new reason must not reset that clock.
    const modeChanged = from !== dto.mode;
    const effectiveFrom = modeChanged || !existing ? new Date() : existing.effectiveFrom;

    const row = await this.prisma.domainMode.upsert({
      where: { userId_domain: { userId, domain } },
      create: { userId, domain, mode: dto.mode, reason: dto.reason ?? null, effectiveFrom },
      update: { mode: dto.mode, reason: dto.reason ?? null, effectiveFrom },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'domain_mode:set',
        targetType: 'domain_mode',
        targetId: row.id,
        meta: { domain, from, to: dto.mode } as Prisma.InputJsonValue,
      },
    });

    return this.toDto(row);
  }

  private toDto(row: DomainMode): DomainModeResponseDto {
    return {
      domain: row.domain,
      mode: row.mode,
      reason: row.reason,
      effectiveFrom: row.effectiveFrom.toISOString(),
    };
  }
}
