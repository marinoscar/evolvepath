import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { PAIN_SAFETY_COPY } from '../safety/workout-safety-copy';
import type { ProgressionSuggestion } from './double-progression';

// =============================================================================
// One sentence about a decision that was already made (issue #85, epic E09)
// =============================================================================
//
// PRD §42: "The AI can explain." Explain — not decide, and not adjust. The
// number on the screen comes from `double-progression.ts` before this file runs,
// and the only thing the model contributes is a readable sentence about it.
//
// THE NUMBER GUARD IS THE WHOLE POINT. A model asked to explain "go to 22.5 kg"
// will occasionally write "go to 25 kg" — a confident, specific, plausible
// sentence a reader cannot tell from a true one, and one that puts weight on a
// bar. So every number in the reply is checked against the small set the
// suggestion actually contains, and a sentence with any other number is thrown
// away in favour of the template. Same shape as `coach-output-guard.ts`: the
// prompt asks, the guard enforces.
//
// THE TEMPLATE IS NOT A DEGRADED MODE. It is a complete, correct sentence that
// ships whenever the provider is down, the user has no key, or the model wrote
// something we will not show — which means the runner never has a blank line
// where the explanation goes.
// =============================================================================

export const PROGRESSION_PROMPT_VERSION = 'progression-explain.v1';
export const PROGRESSION_SCHEMA_NAME = 'progression_explanation';

export const progressionExplanationSchema = z.object({
  sentence: z.string().min(3).max(200),
});

const INSTRUCTIONS = [
  'You explain a training decision that has already been made. You do not make it.',
  '',
  'Write ONE short sentence, in plain language, addressed to the person.',
  'Do not introduce any number that is not already in the recommendation.',
  'Do not change, hedge or second-guess the recommendation.',
  'Do not diagnose anything, and do not give medical or rehabilitation advice.',
  'No exclamation marks, no praise, no "great job".',
].join('\n');

export interface ExplanationResult {
  sentence: string;
  source: 'ai' | 'template';
}

/**
 * The deterministic sentence. Always correct, always available.
 *
 * `discomfort` returns the first sentence of the PRD §45 copy rather than
 * anything about training: the user reported sharp pain, and the only thing
 * this line may say is stop.
 */
export function templateExplanation(
  exerciseName: string,
  suggestion: ProgressionSuggestion,
): string {
  switch (suggestion.reason) {
    case 'discomfort':
      return PAIN_SAFETY_COPY.split('.')[0] + '.';
    case 'top_of_range_twice':
      return suggestion.suggestedWeightKg === null
        ? `Two sessions at the top of the range and comfortable — make ${exerciseName} harder today, or add a rep.`
        : `Two sessions at the top of the range and comfortable — a small increase to ${suggestion.suggestedWeightKg} kg.`;
    case 'below_min_twice':
      return `You've missed the lower bound twice; drop to ${suggestion.suggestedWeightKg} kg and rebuild.`;
    case 'first_session':
      return `First time on ${exerciseName}. Pick a weight you could stop two reps short of, and note what it was.`;
    case 'insufficient_history':
      return 'One session in. Keep the weight and see whether it repeats.';
    default:
      return 'Keep the weight and work toward the top of the rep range on every set.';
  }
}

/** Every number the sentence is allowed to contain. */
function allowedNumbers(suggestion: ProgressionSuggestion): Set<string> {
  const allowed = new Set<string>();

  for (const value of [
    suggestion.suggestedWeightKg,
    suggestion.currentWeightKg,
    suggestion.deltaKg === null ? null : Math.abs(suggestion.deltaKg),
    ...suggestion.basis.lastReps,
    ...suggestion.basis.lastRpe,
    suggestion.basis.sessions,
  ]) {
    if (value === null || value === undefined) continue;

    allowed.add(String(value));
    // "22.5" and "22.50" are the same weight; so are "19" and "19.0".
    allowed.add(String(Number(value)));
  }

  return allowed;
}

/** True when every number in the sentence is one the suggestion actually holds. */
export function numbersAreSafe(sentence: string, suggestion: ProgressionSuggestion): boolean {
  const allowed = allowedNumbers(suggestion);

  return (sentence.match(/\d+(?:\.\d+)?/g) ?? []).every((found) =>
    allowed.has(found) || allowed.has(String(Number(found))),
  );
}

@Injectable()
export class ProgressionExplainerService {
  private readonly logger = new Logger(ProgressionExplainerService.name);

  /**
   * Per `(sessionId, exerciseId)`, for the life of the process.
   *
   * The runner calls this lazily when a chip is tapped, and tapping it twice
   * must not spend the user's key twice. In memory rather than a table because
   * the value is worth exactly one session — a restart losing it costs one
   * regeneration, and a column would be a migration for a sentence.
   */
  private readonly cache = new Map<string, ExplanationResult>();

  constructor(private readonly ai: AiGatewayService) {}

  async explain(
    userId: string,
    key: { sessionId: string; exerciseId: string },
    exerciseName: string,
    suggestion: ProgressionSuggestion,
  ): Promise<ExplanationResult> {
    const cacheKey = `${key.sessionId}:${key.exerciseId}`;
    const cached = this.cache.get(cacheKey);

    if (cached) return cached;

    const template: ExplanationResult = {
      sentence: templateExplanation(exerciseName, suggestion),
      source: 'template',
    };

    // Nothing to explain, and nothing a model could add without inventing a
    // reason the rule did not have.
    if (suggestion.reason === 'discomfort' || suggestion.reason === 'first_session') {
      this.cache.set(cacheKey, template);
      return template;
    }

    const result = await this.ai.invoke({
      persona: 'coach',
      userId,
      promptVersion: PROGRESSION_PROMPT_VERSION,
      instructions: INSTRUCTIONS,
      // Only the movement's name and the rule's own numbers. No free text the
      // user typed, and nothing about their body.
      input: JSON.stringify({
        exercise: exerciseName,
        recommendation: {
          action: suggestion.action,
          currentWeightKg: suggestion.currentWeightKg,
          suggestedWeightKg: suggestion.suggestedWeightKg,
          reason: suggestion.reason,
        },
        lastSession: { reps: suggestion.basis.lastReps, rpe: suggestion.basis.lastRpe },
      }),
      schema: progressionExplanationSchema,
      schemaName: PROGRESSION_SCHEMA_NAME,
      maxOutputTokens: 80,
    });

    const answer =
      result.ok && numbersAreSafe(result.output.sentence, suggestion)
        ? { sentence: result.output.sentence.trim(), source: 'ai' as const }
        : template;

    if (result.ok && answer.source === 'template') {
      this.logger.warn(
        `progression explanation rejected for naming a load the rule did not ` +
          `invocation=${result.invocationId} user=${userId}`,
      );
    }

    this.cache.set(cacheKey, answer);

    return answer;
  }
}
