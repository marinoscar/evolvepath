import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { TestThrottle } from '../ai/gateway/test-throttle';
import { lintBehaviourTitle, type LintResult } from './behaviour-lint';

/** Bumped whenever the instructions below change meaningfully (PRD §117). */
export const BEHAVIOUR_REWRITE_PROMPT_VERSION = 'family-behaviour-rewrite.v1';
export const BEHAVIOUR_REWRITE_SCHEMA_NAME = 'FamilyBehaviourRewrite';

const rewriteSchema = z.object({ suggestion: z.string().min(3).max(120) });

const REWRITE_INSTRUCTIONS = [
  'The user wrote a family commitment that describes another person’s feelings or conduct.',
  'Rewrite it as one concrete action the user will personally do.',
  'At most 12 words. No judgement of the other person, no advice, no explanation.',
  'Keep the people and the occasion the user named.',
  'Return only the rewritten title in `suggestion`.',
].join(' ');

/** What `POST /family/lint` answers with. */
export interface BehaviourCheck {
  ok: boolean;
  code: 'TARGETS_OTHER_PERSON' | null;
  match: string | null;
  suggestion: string | null;
  source: 'ai' | 'none';
}

/**
 * The lint, plus an optional rewrite.
 *
 * THE ORDER IS THE CONTRACT. `check` is pure and synchronous and is what every
 * write path calls; `suggest` is the only thing that touches a provider, runs
 * afterwards, and cannot change the verdict. PRD §120 says the deterministic
 * path must work when AI is down, and here that is structural rather than a
 * timeout: with no provider the user still gets the error, just not the
 * shortcut.
 *
 * Lives in its own module (`behaviour-lint.module.ts`) with no imports beyond
 * `AiModule`, so that `CommitmentsModule` can use it without importing
 * `FamilyModule` — which imports `CommitmentsModule` for the transition matrix.
 */
@Injectable()
export class BehaviourLintService {
  private readonly logger = new Logger(BehaviourLintService.name);

  constructor(
    private readonly ai: AiGatewayService,
    private readonly throttle: TestThrottle,
  ) {}

  /** The verdict. Pure, deterministic, no I/O. */
  check(title: string): LintResult {
    return lintBehaviourTitle(title);
  }

  /**
   * The verdict, plus a rewrite when one is both available and itself clean.
   *
   * Never throws for a provider problem and never returns a non-200 shape: a
   * failed suggestion is `{ suggestion: null, source: 'none' }`, which the UI
   * renders as "the error, without the shortcut button".
   */
  async checkWithSuggestion(userId: string, title: string): Promise<BehaviourCheck> {
    const verdict = this.check(title);

    if (verdict.ok) {
      // No gateway call at all when the title is fine — the common case must
      // not cost a request, a token or a millisecond of provider latency.
      this.logger.log('family.lint ok=true source=none');

      return { ok: true, code: null, match: null, suggestion: null, source: 'none' };
    }

    const base: BehaviourCheck = {
      ok: false,
      code: verdict.code,
      match: verdict.match,
      suggestion: null,
      source: 'none',
    };

    if (!this.throttle.check('family_lint', userId).allowed) {
      this.logger.log('family.lint ok=false source=none reason=throttled');

      return base;
    }

    const result = await this.ai.invoke({
      persona: 'coach',
      userId,
      promptVersion: BEHAVIOUR_REWRITE_PROMPT_VERSION,
      instructions: REWRITE_INSTRUCTIONS,
      input: JSON.stringify({ title, match: verdict.match }),
      schema: rewriteSchema,
      schemaName: BEHAVIOUR_REWRITE_SCHEMA_NAME,
    });

    if (!result.ok) {
      // PRD §120: branch, do not throw. `invoke` never rejects for a provider,
      // key, model or schema problem.
      this.logger.log(`family.lint ok=false source=none reason=${result.error.code}`);

      return base;
    }

    const suggestion = result.output.suggestion.trim();

    // THE SUGGESTION IS RE-LINTED. A model asked to rewrite "Make Mia happier"
    // will sometimes answer "Help Mia feel happier", which is the same
    // commitment. Offering it would make the product contradict the rule it
    // had just enforced.
    if (!this.check(suggestion).ok) {
      this.logger.log('family.lint ok=false source=none reason=suggestion_failed_lint');

      return base;
    }

    // The title itself is NEVER logged: it is family content, and this line
    // exists to answer "is the rewrite path working", not "what did they write".
    this.logger.log('family.lint ok=false source=ai');

    return { ...base, suggestion, source: 'ai' };
  }
}
