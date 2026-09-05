import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { TodayService } from '../today.service';
import type { TodayInsight } from '../today.schema';
import { EMPTY_DAY_INSIGHT, insightTemplateFor } from './insight-templates';
import { TodayInsightCache } from './today-insight.cache';

/** Bumped whenever the instructions change meaningfully (PRD §117). */
export const TODAY_INSIGHT_PROMPT_VERSION = 'today-insight.v1';

/** `json_schema.name` on the wire. */
export const TODAY_INSIGHT_SCHEMA_NAME = 'today_insight';

/**
 * One sentence. The cap is on the schema and not only in the prompt, because a
 * card that grows into a paragraph is a different feature.
 */
export const todayInsightOutputSchema = z.object({ text: z.string().max(280) });

const STYLE_INSTRUCTIONS: Record<string, string> = {
  GENTLE: 'Be warm and unhurried. Never imply the user is behind.',
  BALANCED: 'Be plain and encouraging. No cheerleading, no lecturing.',
  DIRECT: 'Be brief and concrete. Skip the encouragement and name what matters.',
};

export function buildInsightInstructions(coachingStyle: string): string {
  return [
    "You write one sentence for the top of someone's daily planning screen.",
    'Say something true and useful about the shape of their day, using only the facts you are given.',
    'Never invent commitments, numbers or history.',
    'Never give medical, legal or financial advice.',
    'At most 280 characters. One sentence.',
    STYLE_INSTRUCTIONS[coachingStyle] ?? STYLE_INSTRUCTIONS.BALANCED,
  ].join(' ');
}

// =============================================================================
// GET /today/insight (issue #38, epic E05)
// =============================================================================
//
// SEPARATE FROM `GET /today` ON PURPOSE. The screen must render with the
// provider down (PRD §120), and the reliable way to guarantee that is for the
// slow call to be a different request the client makes after the page is up —
// not a call inside the page's own request with a timeout somebody could raise.
//
// The cache lives in its own provider (`TodayInsightCache`) rather than in a
// field here, so the check-in (#43) can invalidate it without depending on this
// service — which would close a dependency cycle back through `TodayService`.
// =============================================================================

@Injectable()
export class TodayInsightService {
  private readonly logger = new Logger(TodayInsightService.name);

  constructor(
    private readonly ai: AiGatewayService,
    private readonly today: TodayService,
    private readonly userProfile: UserProfileService,
    private readonly cache: TodayInsightCache,
  ) {}

  /**
   * Drop this user's cached sentence.
   *
   * Called by E05-03's check-in: a user who just said "low energy" and still
   * reads yesterday's chirpy insight would reasonably conclude nothing listened.
   */
  invalidate(userId: string): void {
    this.cache.invalidate(userId);
  }

  async getInsight(userId: string, now: Date = new Date()): Promise<TodayInsight> {
    const today = await this.today.getToday(userId, now);
    const cached = this.cache.get(userId, today.dateLocal);

    if (cached) return cached;

    const started = Date.now();
    const insight = await this.generate(userId, today, now);

    this.logger.log(
      `today.insight user=${userId} source=${insight.source} latencyMs=${Date.now() - started}`,
    );

    this.cache.set(userId, today.dateLocal, insight);

    return insight;
  }

  private async generate(
    userId: string,
    today: Awaited<ReturnType<TodayService['getToday']>>,
    now: Date,
  ): Promise<TodayInsight> {
    const mode = today.nextBestAction?.interventionMode ?? 'ACT';
    const fallback: TodayInsight = {
      text: today.nextBestAction ? insightTemplateFor(mode) : EMPTY_DAY_INSIGHT,
      source: 'template',
      generatedAt: now.toISOString(),
    };

    const profile = await this.userProfile.find(userId);

    const result = await this.ai.invoke({
      persona: 'coach',
      userId,
      promptVersion: TODAY_INSIGHT_PROMPT_VERSION,
      instructions: buildInsightInstructions(profile?.coachingStyle ?? 'BALANCED'),
      input: JSON.stringify({
        dateLocal: today.dateLocal,
        checkIn: today.checkIn?.feel ?? null,
        // The recommendation, not the commitment: the model gets what the
        // deterministic engine decided, and does not get to re-decide it.
        nextBestAction: today.nextBestAction
          ? {
              title: today.nextBestAction.title,
              domain: today.nextBestAction.domain,
              durationMinutes: today.nextBestAction.durationMinutes,
              interventionMode: today.nextBestAction.interventionMode,
            }
          : null,
        domains: today.domains.map((section) => ({
          domain: section.domain,
          mode: section.mode,
          count: section.commitments.length,
        })),
      }),
      schema: todayInsightOutputSchema,
      schemaName: TODAY_INSIGHT_SCHEMA_NAME,
    });

    // Every failure code lands here — a missing key, a disabled provider, a
    // timeout, a schema violation. None of them is the user's problem on this
    // screen, and none of them is worth a non-200.
    if (!result.ok) return fallback;

    const text = result.output.text.trim();
    if (text.length === 0) return fallback;

    return { text, source: 'ai', generatedAt: now.toISOString() };
  }
}
