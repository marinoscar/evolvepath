import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type WeeklyReview, type WeeklyReviewStatus } from '@prisma/client';
import { trace, type Span } from '@opentelemetry/api';

import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { ContextAssemblerService } from '../coach/context/context-assembler.service';
import { ProposalsService } from '../coach/proposals/proposals.service';
import { PatternAnalysisService } from '../coach/memory/pattern-analysis.service';
import type { ProposalDetailDto } from '../coach/proposals/dto/proposal-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { findOwnedOrThrow } from '../path/owned-resource';
import { safeTimeZone } from '../today/local-date';
import { UserProfileService } from '../user-profile/user-profile.service';
import { AggregationService, aggregateWeek } from './aggregation.service';
import {
  allowedIdsFrom,
  guardReviewOutput,
  WEEKLY_REVIEW_SCHEMA_NAME,
} from './contracts/weekly-review.contract';
import {
  buildWeeklyReviewerInstructions,
  WEEKLY_REVIEWER_PROMPT_VERSION,
} from './prompts/weekly-reviewer.prompt';
import { buildTemplateSummary } from './weekly-review-templates';
import { addDays, defaultReviewWeek, isMonday } from './week-bounds';
import {
  weeklyReviewOutputSchema,
  type WeekAggregates,
  type WeeklyReviewOutput,
  type WeeklyReviewSummary,
} from './weekly.schema';
import type {
  WeeklyReviewDetailDto,
  WeeklyReviewSummaryDto,
} from './dto/weekly-review.dtos';

// =============================================================================
// Generating one week's review (issue #73, epic E10)
// =============================================================================
//
// THE NUMBERS AND THE WORDS ARE TWO SEPARATE THINGS, and the whole design is
// about keeping them that way. `aggregates` is computed by a pure function with
// no model in it; `aiSummary` is the coach's reading of those numbers, and when
// the provider is unreachable it becomes the numbers read back with
// `source: 'template'`. A review is therefore ALWAYS produced (PRD §120) — a
// weekly ritual that only happens when an API is up is not a ritual.
//
// AND THE REVIEWER DOES NOT CHANGE THE PLAN. Its `proposedChanges` become
// `plan_change_proposals` rows through E06-04 and stop there; the plan changes
// only when the user calls `POST /proposals/:id/accept` (PRD §15, §89; VISION
// §19). `AiGatewayService` is injected here and `PlanVersionsService` is not,
// which is the structural half of that promise.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

/**
 * How long a GENERATING row is believed. Past this it is assumed to be the
 * wreckage of a crashed process rather than a run in progress — otherwise a
 * hard restart mid-generation would lock the user out of their own review with
 * a 409 forever.
 */
const GENERATING_STALE_MINUTES = 15;

export type GenerateTrigger = 'cron' | 'manual';

export interface GenerateOptions {
  weekStart?: string;
  trigger: GenerateTrigger;
}

@Injectable()
export class WeeklyReviewService {
  private readonly logger = new Logger(WeeklyReviewService.name);
  private readonly loadSoftCap: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregation: AggregationService,
    private readonly context: ContextAssemblerService,
    private readonly ai: AiGatewayService,
    private readonly proposals: ProposalsService,
    private readonly patternAnalysis: PatternAnalysisService,
    private readonly profiles: UserProfileService,
    config: ConfigService,
  ) {
    this.loadSoftCap = config.get<number>('weekly.loadSoftCap') ?? 8;
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  async generate(
    userId: string,
    options: GenerateOptions,
  ): Promise<WeeklyReviewDetailDto> {
    return tracer.startActiveSpan('weekly.review.generate', async (span) => {
      try {
        return await this.runGeneration(userId, options, span);
      } finally {
        span.end();
      }
    });
  }

  private async runGeneration(
    userId: string,
    { weekStart, trigger }: GenerateOptions,
    span: Span,
  ): Promise<WeeklyReviewDetailDto> {
    const startedAt = Date.now();
    const now = new Date();
    const timeZone = await this.timeZoneFor(userId);
    const week = weekStart ?? defaultReviewWeek(now, timeZone);

    if (!isMonday(week)) {
      throw new BadRequestException({
        code: 'INVALID_WEEK_START',
        message: 'weekStart must be a Monday in YYYY-MM-DD form.',
      });
    }

    const existing = await this.prisma.weeklyReview.findUnique({
      where: { userId_weekStart: { userId, weekStart: week } },
    });

    if (existing?.status === 'APPROVED') {
      // The week has been closed by an approved plan. Rewriting the review it
      // was approved against would make the audit trail a lie.
      throw new ConflictException({
        code: 'WEEKLY_REVIEW_APPROVED',
        message: 'This week has already been approved and cannot be regenerated.',
      });
    }

    if (existing?.status === 'GENERATING' && this.isFresh(existing, now)) {
      throw new ConflictException({
        code: 'WEEKLY_REVIEW_IN_PROGRESS',
        message: 'A review for this week is already being prepared.',
      });
    }

    const previousStatus = existing?.status ?? null;
    const row = await this.prisma.weeklyReview.upsert({
      where: { userId_weekStart: { userId, weekStart: week } },
      create: { userId, weekStart: week, status: 'GENERATING' },
      update: { status: 'GENERATING' },
    });

    try {
      const aggregates = aggregateWeek(
        await this.aggregation.load(userId, week, timeZone),
        { now, timeZone, weekStart: week },
      );

      const { summary, proposalIds, invocationId, dropped } = await this.summarise(
        userId,
        week,
        aggregates,
      );

      await this.prisma.weeklyReview.update({
        where: { id: row.id },
        data: {
          status: 'READY',
          aggregates: aggregates as unknown as Prisma.InputJsonValue,
          aiSummary: summary as unknown as Prisma.InputJsonValue,
          proposalIds,
          invocationId,
          generatedAt: new Date(),
        },
      });

      await this.audit(userId, 'weekly_review:generate', row.id, {
        weekStart: week,
        trigger,
        source: summary.source,
        proposalCount: proposalIds.length,
        droppedProposals: dropped,
        invocationId,
        coveragePartial: aggregates.coverage.partial,
      });

      span.setAttribute('weekly.week_start', week);
      span.setAttribute('weekly.trigger', trigger);
      span.setAttribute('weekly.source', summary.source);
      span.setAttribute('weekly.proposals', proposalIds.length);

      // Detached and non-fatal: a review that is READY in the database has
      // succeeded, and a memory proposer run is not allowed to turn that into a
      // failed request.
      //
      // NOTHING IS NOTIFIED FROM HERE. PRD §60's N8 ("your week is ready to
      // review") is raised by E12's candidate scanner, which reads this table
      // on its own five-minute pass. A `notify()` call at this point would
      // reach the user at whatever hour their sweep ran, straight past quiet
      // hours, the daily cap and the fatigue reduction — the three things
      // routing coaching messages through `decide()` exists to apply.
      void this.patternAnalysis
        .proposeInsights(userId)
        .catch((error) => this.logger.warn(`weekly pattern analysis failed: ${error}`));

      this.logger.log(
        `Weekly review user=${userId} week=${week} trigger=${trigger} ` +
          `source=${summary.source} proposals=${proposalIds.length} ` +
          `latencyMs=${Date.now() - startedAt}`,
      );

      return this.detail(userId, row.id);
    } catch (error) {
      // A review left GENERATING is worse than one that failed: the 409 above
      // would then refuse every retry for fifteen minutes.
      await this.restore(row.id, previousStatus);
      throw error;
    }
  }

  /**
   * Ask the reviewer, or read the numbers back.
   *
   * `invoke` never throws for a provider, key, model or schema problem, so
   * `ok: false` is the ONLY branch a failure takes — including `no_user_key`,
   * which is not an error condition at all but a user who has not brought a key.
   */
  private async summarise(
    userId: string,
    weekStart: string,
    aggregates: WeekAggregates,
  ): Promise<{
    summary: WeeklyReviewSummary;
    proposalIds: string[];
    invocationId: string | null;
    dropped: number;
  }> {
    const template = (): WeeklyReviewSummary => ({
      ...buildTemplateSummary(aggregates, { softCap: this.loadSoftCap }),
      source: 'template',
      promptVersion: null,
      generatedAt: new Date().toISOString(),
    });

    let context;
    try {
      context = await this.context.assemble(userId, 'planner');
    } catch (error) {
      // `assemble` rejects rather than returning a partial context, and a
      // partial context is exactly what would make the reviewer confident about
      // a plan it only half saw. Treat it as an unavailable provider.
      this.logger.warn(`weekly review context unavailable user=${userId}: ${error}`);
      return { summary: template(), proposalIds: [], invocationId: null, dropped: 0 };
    }

    const profile = await this.profiles.find(userId);
    const previous = await this.previousConclusions(userId, weekStart);

    const result = await this.ai.invoke<WeeklyReviewOutput>({
      persona: 'weekly_reviewer',
      userId,
      promptVersion: WEEKLY_REVIEWER_PROMPT_VERSION,
      instructions: buildWeeklyReviewerInstructions({
        style: profile?.coachingStyle ?? context.coachingStyle,
      }),
      input: JSON.stringify({
        weekStart,
        aggregates,
        context: this.context.renderForPrompt(context),
        previous,
      }),
      schema: weeklyReviewOutputSchema,
      schemaName: WEEKLY_REVIEW_SCHEMA_NAME,
      reasoningEffort: 'medium',
    });

    if (!result.ok) {
      this.logger.log(
        `weekly review falling back to template user=${userId} reason=${result.error.code}`,
      );
      return {
        summary: template(),
        proposalIds: [],
        invocationId: result.invocationId,
        dropped: 0,
      };
    }

    const guarded = guardReviewOutput(result.output, allowedIdsFrom(context));

    if (guarded.dropped > 0) {
      this.logger.warn(
        `weekly review guard dropped ${guarded.dropped} proposal(s) ` +
          `user=${userId} invocation=${result.invocationId}`,
      );
    }

    const proposalIds: string[] = [];
    const kept: WeeklyReviewOutput['proposedChanges'] = [];

    for (const proposal of guarded.output.proposedChanges) {
      try {
        const created = await this.proposals.createFromSource(userId, 'WEEKLY_REVIEW', {
          planId: proposal.planId,
          summary: proposal.summary,
          changes: proposal.changes,
          invocationId: result.invocationId,
        });
        proposalIds.push(created.id);
        kept.push(proposal);
      } catch (error) {
        // The protocol refused this one — a plan with no active version, a
        // change that cannot apply. One rejected proposal is not a failed
        // review; the other five outputs are still worth reading.
        this.logger.warn(
          `weekly.review.proposal_rejected user=${userId} plan=${proposal.planId}: ${error}`,
        );
      }
    }

    return {
      summary: {
        ...guarded.output,
        proposedChanges: kept,
        source: 'ai',
        promptVersion: WEEKLY_REVIEWER_PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
      },
      proposalIds,
      invocationId: result.invocationId,
      dropped: guarded.dropped,
    };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(
    userId: string,
    query: { weekStart?: string; limit?: number },
  ): Promise<WeeklyReviewSummaryDto[]> {
    const rows = await this.prisma.weeklyReview.findMany({
      where: { userId, ...(query.weekStart ? { weekStart: query.weekStart } : {}) },
      orderBy: { weekStart: 'desc' },
      take: query.limit ?? 12,
    });

    return rows.map((row) => this.summaryOf(row));
  }

  /** The most recent review, or null for a user who has never had one. */
  async current(userId: string): Promise<WeeklyReviewDetailDto | null> {
    const row = await this.prisma.weeklyReview.findFirst({
      where: { userId },
      orderBy: { weekStart: 'desc' },
    });

    return row ? this.detail(userId, row.id) : null;
  }

  async get(userId: string, id: string): Promise<WeeklyReviewDetailDto> {
    await this.findOwned(userId, id);

    return this.detail(userId, id);
  }

  async skip(userId: string, id: string): Promise<WeeklyReviewSummaryDto> {
    const row = await this.findOwned(userId, id);

    if (row.status !== 'READY') {
      throw new ConflictException({
        code: 'WEEKLY_REVIEW_NOT_SKIPPABLE',
        message: `A ${row.status} review cannot be skipped.`,
      });
    }

    const updated = await this.prisma.weeklyReview.update({
      where: { id },
      data: { status: 'SKIPPED' },
    });

    await this.audit(userId, 'weekly_review:skip', id, { weekStart: row.weekStart });

    return this.summaryOf(updated);
  }

  /**
   * Close the week a plan was approved against (E10-03's approve calls this).
   *
   * A no-op when there is no review or it is already APPROVED — approving next
   * week must not require that a review of last week ever existed.
   */
  async markApproved(
    userId: string,
    weekStart: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const row = await tx.weeklyReview.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    });

    if (!row || row.status === 'APPROVED') return;

    await tx.weeklyReview.update({
      where: { id: row.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async detail(userId: string, id: string): Promise<WeeklyReviewDetailDto> {
    const row = await this.findOwned(userId, id);

    const proposals: ProposalDetailDto[] = [];
    for (const proposalId of row.proposalIds) {
      try {
        proposals.push(await this.proposals.get(userId, proposalId));
      } catch {
        // Expired and pruned. The review is a historical record; a proposal
        // that no longer exists is simply not shown. See the schema header for
        // why there is no foreign key holding it in place.
      }
    }

    const plan = await this.prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId, weekStart: addDays(row.weekStart, 7) } },
      select: { id: true, status: true },
    });

    return {
      ...this.summaryOf(row),
      aggregates: row.aggregates,
      aiSummary: row.aiSummary,
      proposals,
      plan,
    };
  }

  private summaryOf(row: WeeklyReview): WeeklyReviewSummaryDto {
    const aggregates = row.aggregates as unknown as WeekAggregates | null;
    const domains = aggregates?.domains;

    return {
      id: row.id,
      weekStart: row.weekStart,
      status: row.status,
      counts: {
        WORK: { planned: domains?.WORK.planned ?? 0, completed: domains?.WORK.completed ?? 0 },
        FAMILY: {
          planned: domains?.FAMILY.planned ?? 0,
          completed: domains?.FAMILY.completed ?? 0,
        },
        HEALTH: {
          planned: domains?.HEALTH.planned ?? 0,
          completed: domains?.HEALTH.completed ?? 0,
        },
      },
      generatedAt: row.generatedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * What the last review told the user to keep and not to add.
   *
   * Passed back in so the reviewer does not contradict itself week to week —
   * "do not add a second workout day yet" followed seven days later by "add a
   * second workout day" is how a coach loses a user's trust.
   */
  private async previousConclusions(
    userId: string,
    weekStart: string,
  ): Promise<{ keepUnchanged: string[]; doNotAddYet: string[] } | null> {
    const row = await this.prisma.weeklyReview.findFirst({
      where: {
        userId,
        weekStart: { lt: weekStart },
        status: { in: ['READY', 'APPROVED'] satisfies WeeklyReviewStatus[] },
      },
      orderBy: { weekStart: 'desc' },
      select: { aiSummary: true },
    });

    const summary = row?.aiSummary as unknown as WeeklyReviewSummary | null;
    if (!summary) return null;

    return {
      keepUnchanged: summary.keepUnchanged ?? [],
      doNotAddYet: summary.doNotAddYet ?? [],
    };
  }

  private async restore(id: string, previousStatus: WeeklyReviewStatus | null): Promise<void> {
    try {
      if (previousStatus === null) {
        await this.prisma.weeklyReview.delete({ where: { id } });
      } else {
        await this.prisma.weeklyReview.update({
          where: { id },
          data: { status: previousStatus },
        });
      }
    } catch (error) {
      this.logger.error(`failed to restore weekly review ${id}: ${error}`);
    }
  }

  private isFresh(row: WeeklyReview, now: Date): boolean {
    return now.getTime() - row.updatedAt.getTime() < GENERATING_STALE_MINUTES * 60_000;
  }

  private async findOwned(userId: string, id: string): Promise<WeeklyReview> {
    return findOwnedOrThrow(
      () => this.prisma.weeklyReview.findFirst({ where: { id, userId } }),
      'Weekly review',
    );
  }

  private async timeZoneFor(userId: string): Promise<string> {
    const profile = await this.profiles.find(userId);

    return safeTimeZone(profile?.timezone);
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'weekly_review',
        targetId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
