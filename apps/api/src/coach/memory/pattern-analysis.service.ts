import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { safeTimeZone } from '../../today/local-date';
import {
  INSIGHT_PROPOSAL_SCHEMA_NAME,
  insightProposalSchema,
  type InsightProposal,
} from '../contracts/insight-proposal.contract';
import {
  PATTERN_ANALYST_PROMPT,
  PATTERN_ANALYST_PROMPT_VERSION,
} from '../prompts/pattern-analyst.prompt';
import { aggregateStats } from './pattern-stats';
import { toDto } from './memory-insights.service';
import type { MemoryInsightDto } from './dto/memory-insight.dto';

// =============================================================================
// The pattern-analysis proposer (issue #78, epic E06)
// =============================================================================
//
// VISION §23's loop: "I've noticed you complete morning workouts much more
// consistently. Save that as a planning preference? Yes / No." Everything here
// serves the second half of that sentence — the question, not the assertion.
//
// WHAT IT SENDS IS COUNTS. `aggregateStats` produces a table of numbers with no
// titles, no reflection text and no names, and that is what reaches the model.
// The `pattern_analyst` persona is the one that writes durable sentences about
// a person, so it is the one that must be given the least to work from.
//
// AND EVERY OUTCOME IS A 200. Not enough history is `insufficient_data`; a
// provider outage is `ai_unavailable`. Neither is an error, because neither is
// a broken screen — a user who has been here a week simply has nothing to
// analyse yet.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

/** How long an unconfirmed AI guess about someone stays live. */
export const INSIGHT_TTL_DAYS = 90;

/** Fewer decided commitments than this and there is nothing to infer from. */
export const MIN_SAMPLE = 10;

/** How far back the aggregate looks. */
export const ANALYSIS_WINDOW_DAYS = 28;

export interface ProposeResult {
  created: MemoryInsightDto[];
  skipped: 'insufficient_data' | 'ai_unavailable' | null;
}

@Injectable()
export class PatternAnalysisService {
  private readonly logger = new Logger(PatternAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly notifications: NotificationsService,
  ) {}

  async proposeInsights(userId: string): Promise<ProposeResult> {
    return tracer.startActiveSpan('memory.propose', async (span) => {
      try {
        const result = await this.run(userId);
        span.setAttribute('memory.created', result.created.length);
        span.setAttribute('memory.skipped', result.skipped ?? 'none');
        return result;
      } finally {
        span.end();
      }
    });
  }

  private async run(userId: string): Promise<ProposeResult> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const timezone = safeTimeZone(profile?.timezone);

    const since = new Date(
      Date.now() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const commitments = await this.prisma.commitment.findMany({
      where: { userId, scheduledStart: { gte: since } },
      select: {
        status: true,
        domain: true,
        scheduledStart: true,
        rescheduleCount: true,
        versionUsed: true,
        minutesSpent: true,
        fullMinutes: true,
        skipReason: true,
      },
    });

    const stats = aggregateStats(commitments, timezone);

    if (stats.sampleSize < MIN_SAMPLE) {
      // No model call. A week of history cannot support a statement about how
      // somebody works, and asking anyway would produce a confident one.
      return { created: [], skipped: 'insufficient_data' };
    }

    // Existing statements go in so the model does not re-propose them — INCLUDING
    // `doNotUse` rows. "Forgotten" rows are genuinely gone and may legitimately
    // come back; "don't use this" is an answer, and re-asking would be the
    // product ignoring it.
    const existing = await this.prisma.memoryInsight.findMany({
      where: { userId },
      select: { category: true, statement: true },
    });

    const result = await this.ai.invoke<InsightProposal>({
      persona: 'pattern_analyst',
      userId,
      promptVersion: PATTERN_ANALYST_PROMPT_VERSION,
      instructions: PATTERN_ANALYST_PROMPT,
      input: JSON.stringify({
        stats,
        existingStatements: existing.map((row) => ({
          category: row.category,
          statement: row.statement,
        })),
      }),
      schema: insightProposalSchema,
      schemaName: INSIGHT_PROPOSAL_SCHEMA_NAME,
    });

    if (!result.ok) {
      this.logger.log(
        `memory.propose user=${userId} skipped=ai_unavailable code=${result.error.code}`,
      );
      return { created: [], skipped: 'ai_unavailable' };
    }

    const seen = new Set(
      existing.map((row) => key(row.category, row.statement)),
    );

    const fresh = result.output.insights.filter((insight) => {
      const id = key(insight.category, insight.statement);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (fresh.length === 0) {
      return { created: [], skipped: null };
    }

    const expiresAt = new Date(
      Date.now() + INSIGHT_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    const created = await this.prisma.$transaction(
      fresh.map((insight) =>
        this.prisma.memoryInsight.create({
          data: {
            userId,
            category: insight.category,
            statement: insight.statement,
            evidenceCount: insight.evidenceCount,
            confidence: insight.confidence,
            // PRD §10.12: a durable inference needs explicit approval before
            // it becomes a planning assumption. Unconfirmed means the coach
            // does not see it — the assembler's query says so.
            userConfirmed: false,
            doNotUse: false,
            source: 'AI',
            expiresAt,
            invocationId: result.invocationId,
          },
        }),
      ),
    );

    await this.audit(userId, created.length);

    // After the rows are committed and outside the transaction, per the repo's
    // notification recipe.
    await this.notifications.notify('memory.insight_proposed', userId, {
      count: created.length,
    });

    this.logger.log(
      `memory.propose user=${userId} created=${created.length} invocation=${result.invocationId}`,
    );

    return { created: created.map(toDto), skipped: null };
  }

  private async audit(userId: string, count: number): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'memory_insight:propose',
        targetType: 'memory_insight',
        targetId: userId,
        meta: { count },
      },
    });
  }
}

/** Case-insensitive dedupe key. Two spellings of one idea are one idea. */
function key(category: string, statement: string): string {
  return `${category}:${statement.trim().toLowerCase()}`;
}
