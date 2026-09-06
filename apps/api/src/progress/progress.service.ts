import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { DOMAINS } from '../path/domain.schema';
import {
  INDEPENDENCE_READER,
  type IndependenceReader,
} from './independence/independence-reader';
import { localWeekBounds } from '../today/local-date';
import { computeConsistencyRun } from './momentum/consistency-run';
import type { Domain, MomentumResult } from './momentum/momentum-engine';
import { WINDOW_DAYS } from './momentum/momentum-engine';
import { MilestonesService } from './milestones/milestones.service';
import { MomentumService } from './momentum/momentum.service';
import { computeRecoveryLatency } from './momentum/recovery-latency';
import type { MomentumPayload, ProgressResponse } from './progress.schema';

// =============================================================================
// GET /progress (issue #98, epic E11)
// =============================================================================
//
// PRD §75's sections in one response: momentum per domain, the consistency run,
// recovery, coach dependency, milestones and the confirmed insights.
//
// One load, then pure functions. Nothing here calls AI — every state in this
// epic is computed (PRD §53, §120), and the coach's contribution to Progress is
// the wording of a restart action in E11-02, nothing more.
// =============================================================================

const TREND_WEEKS = 4;

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly momentum: MomentumService,
    private readonly milestones: MilestonesService,
    @Inject(INDEPENDENCE_READER) private readonly independence: IndependenceReader,
  ) {}

  async getProgress(userId: string, now: Date = new Date()): Promise<ProgressResponse> {
    const loaded = await this.momentum.load(userId, now);
    const momentum = this.momentum.compute(loaded);

    const consistencyRun = computeConsistencyRun(loaded.history, now, loaded.timeZone);
    const recovery = computeRecoveryLatency(loaded.history);

    const [independence, insights, milestones] = await Promise.all([
      this.independence.read(userId, new Date(now.getTime() - 28 * 86_400_000), now),
      this.confirmedInsights(userId),
      this.milestones.forProgress(userId),
    ]);

    return {
      generatedAt: now.toISOString(),
      windowDays: WINDOW_DAYS as 28,
      momentum: Object.fromEntries(
        DOMAINS.map((domain) => [
          domain,
          this.toPayload(momentum[domain as Domain], consistencyRun.weekly, loaded, domain as Domain),
        ]),
      ) as ProgressResponse['momentum'],
      consistencyRun,
      recovery,
      independence,
      milestones,
      insights,
    };
  }

  /**
   * PRD §85: an insight the user marked "don't use for coaching" is not shown
   * back to them as something the coach knows, and an unconfirmed guess is not
   * presented as a fact about them.
   */
  private async confirmedInsights(userId: string) {
    const rows = await this.prisma.memoryInsight.findMany({
      where: { userId, userConfirmed: true, doNotUse: false },
      select: { id: true, category: true, statement: true },
      orderBy: [{ category: 'asc' }, { confidence: 'desc' }],
      take: 20,
    });

    return (rows ?? []).map((row) => ({
      id: row.id,
      category: String(row.category),
      statement: row.statement,
    }));
  }

  private toPayload(
    result: MomentumResult,
    weekly: ProgressResponse['consistencyRun']['weekly'],
    loaded: Awaited<ReturnType<MomentumService['load']>>,
    domain: Domain,
  ): MomentumPayload {
    const { signals } = result;

    return {
      domain,
      state: result.state,
      evidence: result.evidence,
      signals: {
        planned: signals.planned,
        completed: signals.completed,
        partial: signals.partial,
        fallback: signals.fallback,
        missed: signals.missed,
        skipped: signals.skipped,
        consecutiveMisses: signals.consecutiveMisses,
        rescheduledTwice: signals.rescheduledTwice,
        lastCompletionAt: signals.lastCompletionAt?.toISOString() ?? null,
        lastMissAt: signals.lastMissAt?.toISOString() ?? null,
        returnedAfterIdleDays: signals.returnedAfterIdleDays,
      },
      trend: this.trendFor(domain, weekly, loaded),
    };
  }

  /**
   * The last four weeks in ONE domain.
   *
   * The run's `weekly` is all three domains, so it supplies the week LABELS and
   * the domain's rows are counted against the same boundaries — one definition
   * of "a week" for the bars and the line, resolved through `localWeekBounds`
   * so a Sunday 23:30 completion in `America/Costa_Rica` lands in that week.
   *
   * Always four entries: a missing bar and a zero bar say different things, and
   * a chart that changes length in a user's first month looks broken.
   */
  private trendFor(
    domain: Domain,
    weekly: ProgressResponse['consistencyRun']['weekly'],
    loaded: Awaited<ReturnType<MomentumService['load']>>,
  ): MomentumPayload['trend'] {
    const buckets = weekly.slice(-TREND_WEEKS);
    const rows = loaded.history.filter((row) => row.domain === domain);

    const points = buckets.map((week) => {
      const { start, end } = localWeekBounds(week.weekStart, loaded.timeZone);
      const inWeek = rows.filter(
        (row) => row.scheduledStart >= start && row.scheduledStart < end,
      );

      return {
        weekStart: week.weekStart,
        planned: inWeek.length,
        completed: inWeek.filter(
          (row) => row.status === 'COMPLETED' || row.status === 'PARTIALLY_COMPLETED',
        ).length,
      };
    });

    while (points.length < TREND_WEEKS) {
      points.unshift({ weekStart: '', planned: 0, completed: 0 });
    }

    return points.slice(-TREND_WEEKS);
  }
}
