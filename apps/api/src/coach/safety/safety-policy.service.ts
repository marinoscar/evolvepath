import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { safetyModelSchema } from '../contracts/safety-decision.contract';
import {
  SAFETY_PROMPT,
  SAFETY_PROMPT_VERSION,
  SAFETY_SCHEMA_NAME,
} from '../prompts/safety.prompt';
import {
  SAFETY_CONSERVATIVE_NOTE,
  SAFETY_REDIRECT_COPY,
} from './safety-copy';
import { matchRules, type SafetyRule } from './safety-patterns';
import type {
  SafetyCategory,
  SafetyDecision,
  SafetySurface,
} from './safety.types';

// =============================================================================
// SafetyPolicyService (issue #82, epic E06)
// =============================================================================
//
// THE ORDER OF THE TWO STEPS IS THE DESIGN. A deterministic pre-check runs
// first and settles most traffic with no model call, and the model is asked
// only about the ambiguous middle. That is not an optimisation:
//
//   * A user typing "I have sharp chest pain when I run" gets the professional
//     -care copy immediately, and gets it when the provider is down, when the
//     user has no API key, and when their key has run out of credit. A
//     model-first design has nothing to say in exactly those cases.
//   * The words a user in trouble reads are a constant in `safety-copy.ts`,
//     reviewed once, rather than whatever a model produced this time.
//
// AND FAILURE LEANS ONE WAY. When the `safety` persona cannot be reached, an
// ambiguous message becomes `conservative` — never `allow`, and never an
// exception. `evaluate` does not throw: a safety layer that can take the
// product down is a safety layer someone will eventually be tempted to remove.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

export interface SafetyEvaluateRequest {
  userId: string;
  text: string;
  surface: SafetySurface;
}

@Injectable()
export class SafetyPolicyService {
  private readonly logger = new Logger(SafetyPolicyService.name);

  constructor(private readonly ai: AiGatewayService) {}

  async evaluate(request: SafetyEvaluateRequest): Promise<SafetyDecision> {
    return tracer.startActiveSpan('safety.evaluate', async (span) => {
      try {
        const decision = await this.decide(request);

        span.setAttribute('safety.decision', decision.decision);
        span.setAttribute('safety.category', decision.category);
        span.setAttribute('safety.source', decision.source);
        if (decision.matchedRule) {
          span.setAttribute('safety.rule', decision.matchedRule);
        }

        // Decision, category, source, surface, rule id. NEVER the text — the
        // one thing on this path that must not reach a log aggregator.
        this.logger.log(
          `safety decision=${decision.decision} category=${decision.category} ` +
            `source=${decision.source} surface=${request.surface} ` +
            `rule=${decision.matchedRule ?? 'none'}`,
        );

        return decision;
      } finally {
        span.end();
      }
    });
  }

  private async decide(
    request: SafetyEvaluateRequest,
  ): Promise<SafetyDecision> {
    const matches = precheck(request.text);

    if (matches.definite) {
      return {
        decision: 'redirect',
        category: matches.definite.category,
        userFacingNote: SAFETY_REDIRECT_COPY[matches.definite.category],
        source: 'precheck',
        matchedRule: matches.definite.id,
      };
    }

    if (matches.ambiguous.length === 0) {
      return { decision: 'allow', category: 'none', source: 'precheck' };
    }

    return this.askModel(request, matches.ambiguous);
  }

  private async askModel(
    request: SafetyEvaluateRequest,
    ambiguous: SafetyRule[],
  ): Promise<SafetyDecision> {
    const fallbackCategory = ambiguous[0].category;

    const result = await this.ai.invoke({
      persona: 'safety',
      userId: request.userId,
      promptVersion: SAFETY_PROMPT_VERSION,
      instructions: SAFETY_PROMPT,
      input: JSON.stringify({
        text: request.text,
        surface: request.surface,
        matchedRules: ambiguous.map((rule) => rule.id),
      }),
      schema: safetyModelSchema,
      schemaName: SAFETY_SCHEMA_NAME,
      maxOutputTokens: 200,
    });

    if (!result.ok) {
      // Toward caution, never toward silence, and never toward blocking the
      // deterministic product. The caller still gets a decision it can act on.
      return {
        decision: 'conservative',
        category: fallbackCategory,
        userFacingNote: SAFETY_CONSERVATIVE_NOTE,
        source: 'model_unavailable',
        matchedRule: ambiguous[0].id,
        promptVersion: SAFETY_PROMPT_VERSION,
      };
    }

    const { decision, category } = result.output;

    const resolved: SafetyDecision = {
      decision,
      // "allow" with a named category, or a redirect with none, are both
      // incoherent answers. Normalise rather than propagate: the copy lookup
      // below indexes on the category and would otherwise be undefined.
      category: decision === 'allow' ? 'none' : normaliseCategory(category, fallbackCategory),
      source: 'model',
      matchedRule: ambiguous[0].id,
      promptVersion: SAFETY_PROMPT_VERSION,
    };

    if (resolved.decision === 'redirect') {
      resolved.userFacingNote =
        SAFETY_REDIRECT_COPY[
          resolved.category as Exclude<SafetyCategory, 'none'>
        ];
    } else if (resolved.decision === 'conservative') {
      resolved.userFacingNote = SAFETY_CONSERVATIVE_NOTE;
    }

    return resolved;
  }
}

/** A model that says "none" for a non-allow decision falls back to the rule. */
function normaliseCategory(
  category: SafetyCategory,
  fallback: Exclude<SafetyCategory, 'none'>,
): SafetyCategory {
  return category === 'none' ? fallback : category;
}

/**
 * The deterministic half, as a pure function.
 *
 * NO NEST, NO CLOCK, NO I/O — exported on its own so the fixture spec can run
 * it 40+ times without standing up a module, and so nothing about it can
 * become non-deterministic by accident.
 */
export function precheck(text: string): {
  definite: SafetyRule | null;
  ambiguous: SafetyRule[];
} {
  const matched = matchRules(text ?? '');

  return {
    // Table order is precedence — crisis rules come first. See safety-patterns.
    definite: matched.find((rule) => rule.strength === 'definite') ?? null,
    ambiguous: matched.filter((rule) => rule.strength === 'ambiguous'),
  };
}
