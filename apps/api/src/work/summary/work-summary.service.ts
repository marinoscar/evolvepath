import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { PrismaService } from '../../prisma/prisma.service';
import { safeTimeZone } from '../../today/local-date';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { addDays, isMonday, weekStartFor } from '../../weekly/week-bounds';
import { AvoidanceService } from '../avoidance/avoidance.service';
import type { AvoidanceAssessment } from '../avoidance/avoidance-detector';
import { aggregateWorkWeek, type WorkWeeklySummary } from './work-summary.aggregator';

// =============================================================================
// GET /work/summary (issue #120, epic E07)
// =============================================================================
//
// Loads rows, calls the pure aggregator, returns. Nothing is cached and nothing
// is persisted: E10-01 owns the `weekly_reviews` row, and a second stored copy
// of the same week would be one more thing that could disagree with the first.
//
// The commitment window is DELIBERATELY WIDER than the week (±7 days). PRD §29
// wants repeatedly postponed work named, and the most postponed commitment of
// the week is very often the one that was pushed out of it — which is no longer
// inside the week's own bounds.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

/** How far either side of the week to look for rows that touch it. */
export const LOOKAROUND_DAYS = 7;

@Injectable()
export class WorkSummaryService {
  private readonly logger = new Logger(WorkSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
    private readonly avoidance: AvoidanceService,
  ) {}

  async getWeek(
    userId: string,
    weekStart?: string,
    now: Date = new Date(),
  ): Promise<WorkWeeklySummary> {
    return tracer.startActiveSpan('work.summary.week', async (span) => {
      try {
        const profile = await this.profiles.find(userId);
        const timezone = safeTimeZone(profile?.timezone);
        const week = weekStart ?? weekStartFor(now, timezone);

        if (Number.isNaN(new Date(`${week}T00:00:00Z`).getTime())) {
          throw new BadRequestException({
            message: 'weekStart must be a YYYY-MM-DD date.',
            details: { reason: 'INVALID_WEEK_START', weekStart: week },
          });
        }

        if (!isMonday(week)) {
          throw new BadRequestException({
            message: 'weekStart must be a Monday in the user\'s timezone.',
            details: { reason: 'WEEK_START_NOT_MONDAY', weekStart: week },
          });
        }

        const from = new Date(`${addDays(week, -LOOKAROUND_DAYS)}T00:00:00.000Z`);
        const to = new Date(`${addDays(week, 7 + LOOKAROUND_DAYS)}T00:00:00.000Z`);

        // Four queries, and every one of them scoped by `userId`. There is no
        // cross-user aggregation path in this service at all.
        const commitments = await this.prisma.commitment.findMany({
          where: { userId, domain: 'WORK', scheduledStart: { gte: from, lt: to } },
          select: {
            id: true,
            domain: true,
            title: true,
            outcomeId: true,
            commitmentType: true,
            status: true,
            scheduledStart: true,
            scheduledEnd: true,
            startedAt: true,
            rescheduleCount: true,
            fullMinutes: true,
          },
        });

        const commitmentIds = commitments.map((row) => row.id);

        const [focusSessions, evidence, outcomes] = await Promise.all([
          this.prisma.focusSession.findMany({
            where: { userId, commitmentId: { in: commitmentIds } },
            select: {
              id: true,
              commitmentId: true,
              startedAt: true,
              endedAt: true,
              outcome: true,
              actualMinutes: true,
              distractionNotes: true,
            },
          }),
          this.prisma.evidence.findMany({
            where: { userId, commitmentId: { in: commitmentIds } },
            select: { commitmentId: true, evidenceType: true, source: true },
          }),
          this.prisma.outcome.findMany({
            where: { userId, domain: 'WORK' },
            select: { id: true, title: true, domain: true, state: true, updatedAt: true },
          }),
        ]);

        // Only the postponed ones need a ladder reading; assessing every
        // commitment of a fortnight would be four more queries for numbers
        // nothing in this response reports.
        const postponed = commitments.filter((row) => row.rescheduleCount >= 2);
        const assessments = await this.assessmentsOrEmpty(userId, postponed, now, timezone);

        const summary = aggregateWorkWeek({
          weekStart: week,
          timezone,
          commitments,
          focusSessions,
          evidence,
          outcomes,
          assessments,
        });

        this.logger.log(
          `Work summary user=${userId} week=${week} due=${summary.starts.commitmentsDue}`,
        );

        return summary;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Ladder levels, or none.
   *
   * A summary is a report; a failed assessment must not turn it into a 500 when
   * every count in it is already correct. The postponed rows still appear, with
   * `level: 0`.
   */
  private async assessmentsOrEmpty(
    userId: string,
    rows: Array<{ id: string }>,
    now: Date,
    timezone: string,
  ): Promise<Map<string, AvoidanceAssessment>> {
    if (rows.length === 0) return new Map();

    try {
      const full = await this.prisma.commitment.findMany({
        where: { userId, id: { in: rows.map((row) => row.id) } },
      });

      return await this.avoidance.assessMany(userId, full, now, timezone);
    } catch (error) {
      this.logger.warn(
        `avoidance unavailable for work summary: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return new Map();
    }
  }
}
