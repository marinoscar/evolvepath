import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Commitment } from '@prisma/client';

import { findOwnedOrThrow } from '../../path/owned-resource';
import { PrismaService } from '../../prisma/prisma.service';
import { safeTimeZone } from '../../today/local-date';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { AvoidanceSignalsService } from './avoidance-signals.service';
import { detectAvoidance, type AvoidanceAssessment } from './avoidance-detector';

// =============================================================================
// Assessing commitments (issue #116, epic E07)
// =============================================================================
//
// THERE IS NO STORED `avoidanceLevel` COLUMN, deliberately. The signals move
// every day — "untouched for three days" becomes four overnight without anybody
// touching a row — so a persisted level would contradict `GET /today` within
// hours of being written, and the contradiction would be invisible. The level
// is derived on every read, from a batched query whose cost does not grow with
// the number of cards.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

@Injectable()
export class AvoidanceService {
  private readonly logger = new Logger(AvoidanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signals: AvoidanceSignalsService,
    private readonly profiles: UserProfileService,
  ) {}

  /** One assessment per commitment id. Non-WORK rows are simply absent. */
  async assessMany(
    userId: string,
    commitments: Commitment[],
    now: Date = new Date(),
    timezone?: string,
  ): Promise<Map<string, AvoidanceAssessment>> {
    return tracer.startActiveSpan('work.avoidance.assess', async (span) => {
      try {
        const work = commitments.filter((c) => c.domain === 'WORK');
        const zone = timezone ?? (await this.timezoneFor(userId));

        const collected = await this.signals.collectMany(userId, work, now, zone);
        const assessments = new Map<string, AvoidanceAssessment>();

        for (const [commitmentId, { signals, askedRecently }] of collected) {
          assessments.set(commitmentId, detectAvoidance(signals, { askedRecently }));
        }

        span.setAttribute(
          'work.avoidance.level',
          Math.max(0, ...[...assessments.values()].map((a) => a.level)),
        );

        return assessments;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /** The assessment for one commitment. 404 for another user's. */
  async assessOne(
    userId: string,
    commitmentId: string,
    now: Date = new Date(),
  ): Promise<AvoidanceAssessment> {
    const commitment = await findOwnedOrThrow(
      () => this.prisma.commitment.findFirst({ where: { id: commitmentId, userId } }),
      'Commitment',
    );

    if (commitment.domain !== 'WORK') {
      throw new BadRequestException({
        message: 'Avoidance is assessed for Work commitments only.',
        details: { reason: 'COMMITMENT_NOT_WORK', domain: commitment.domain },
      });
    }

    const assessments = await this.assessMany(userId, [commitment], now);

    return assessments.get(commitmentId) as AvoidanceAssessment;
  }

  private async timezoneFor(userId: string): Promise<string> {
    const profile = await this.profiles.find(userId);

    return safeTimeZone(profile?.timezone);
  }
}
