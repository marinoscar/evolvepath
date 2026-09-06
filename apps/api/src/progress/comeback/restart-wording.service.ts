import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { isKindEnough, OFFER_NOTE } from './comeback-copy';
import type { RestartPlan } from './restart-picker';

// =============================================================================
// The coach's wording for a restart (issue #112, epic E11)
// =============================================================================
//
// THE MODEL NAMES THE THING; IT NEVER CHOOSES IT. `restart-picker.ts` has
// already decided the domain, the routine and the minutes. All that is asked
// here is a warmer sentence for the same behaviour — so a provider outage
// changes the wording and nothing else (PRD §120).
//
// The banned-word gate applies to the OUTPUT, not only to the prompt. Asking a
// model not to say "overdue" is a request; checking is a guarantee, and this is
// the one screen in the product where the wrong word does the specific damage
// the feature exists to prevent.
// =============================================================================

export const COMEBACK_WORDING_PROMPT_VERSION = 'comeback-restart.v1';
export const COMEBACK_WORDING_SCHEMA_NAME = 'ComebackRestartWording';

const wordingSchema = z.object({
  title: z.string().max(80),
  note: z.string().max(160),
});

export interface RestartWording {
  title: string;
  note: string;
  source: 'ai' | 'template';
}

function instructionsFor(coachingStyle: string): string {
  return [
    'You are writing two short lines for somebody returning to their plan after a pause.',
    'You are NOT choosing what they should do — the behaviour, the domain and the duration are',
    'already decided and given to you. Rewrite the title in their own register and add one',
    'encouraging note.',
    '',
    'Rules:',
    '- The title must name the SAME behaviour and the SAME duration. Never invent a new goal.',
    '- Never mention missed days, overdue items, streaks, being behind, or catching up.',
    '- No guilt, no praise for suffering, no exclamation marks.',
    '- Title: at most 80 characters. Note: at most 160 characters, one sentence.',
    `- Tone: ${coachingStyle.toLowerCase()}.`,
  ].join('\n');
}

@Injectable()
export class RestartWordingService {
  constructor(private readonly ai: AiGatewayService) {}

  /**
   * Never throws and never rejects an offer.
   *
   * A failure, a missing key, a schema violation or a banned word all land on
   * the same deterministic template — the comeback loop is the last place that
   * should depend on a provider being up.
   */
  async compose(
    userId: string,
    restart: RestartPlan,
    coachingStyle: string,
    idleDays: number,
  ): Promise<RestartWording> {
    const template: RestartWording = {
      title: restart.title,
      note: OFFER_NOTE,
      source: 'template',
    };

    const result = await this.ai.invoke({
      persona: 'coach',
      userId,
      promptVersion: COMEBACK_WORDING_PROMPT_VERSION,
      instructions: instructionsFor(coachingStyle),
      input: JSON.stringify({
        domain: restart.domain,
        title: restart.title,
        minutes: restart.minutes,
        idleDays,
        reason: restart.reason,
      }),
      schema: wordingSchema,
      schemaName: COMEBACK_WORDING_SCHEMA_NAME,
    });

    if (!result.ok) return template;

    const title = result.output.title.trim();
    const note = result.output.note.trim();

    if (title.length === 0 || note.length === 0) return template;
    if (!isKindEnough(title) || !isKindEnough(note)) return template;

    return { title, note, source: 'ai' };
  }
}
