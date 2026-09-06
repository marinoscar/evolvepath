import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { AiKeyRequiredException, type AiErrorCode } from '../ai/gateway/ai-errors';
import { localDate } from '../today/local-date';
import {
  ONBOARDING_INSTRUCTIONS,
  ONBOARDING_REDUCE_INSTRUCTIONS,
} from './onboarding.instructions';
import {
  ONBOARDING_PROPOSAL_PROMPT_VERSION,
  ONBOARDING_PROPOSAL_SCHEMA_NAME,
  onboardingProposalSchema,
  type OnboardingProposal,
} from './onboarding-proposal.schema';
import {
  validateOnboardingProposal,
  type GuardrailContext,
} from './onboarding.guardrails';
import type { OnboardingAnswers } from './onboarding.types';

// =============================================================================
// Asking the planner for a first Path (issue #101, epic E04)
// =============================================================================
//
// ONE JOB: turn answers into a validated proposal, or fail in a way the caller
// can act on. It writes nothing — not the proposal, not an audit row. Storage
// is `OnboardingService`'s, because "the AI proposed something" and "we saved
// what the AI proposed" are two decisions and only the second one is PRD §15's.
//
// THE GUARDRAILS RUN ON THE MODEL'S OUTPUT AND A FAILURE IS TREATED AS A SCHEMA
// FAILURE. A plan this service corrected would be a plan the user approves
// believing the coach wrote it; there is no half-accepted proposal.
// =============================================================================

/** Which failures are worth a retry button rather than a "continue without AI". */
const RETRYABLE: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'rate_limit',
  'timeout',
  'network',
  'provider',
]);

export interface ProposeInput {
  userId: string;
  answers: OnboardingAnswers;
  guardrails: GuardrailContext;
  /** The plan we are being asked to shrink (PRD §72). */
  previousProposal?: OnboardingProposal | null;
  requestId?: string;
}

@Injectable()
export class OnboardingProposalService {
  private readonly logger = new Logger(OnboardingProposalService.name);

  constructor(private readonly ai: AiGatewayService) {}

  /**
   * The planner's proposal, already checked against every guardrail.
   *
   * Throws — 412 for the one failure the user can fix, 503 for everything
   * else — because there is nothing useful to return: the caller's fallback is
   * a different route (`skip-ai`), chosen by the person, not by this code.
   */
  async propose(input: ProposeInput): Promise<{
    proposal: OnboardingProposal;
    invocationId: string;
  }> {
    const reduceLoad = input.previousProposal != null;

    const result = await this.ai.invoke({
      persona: 'planner',
      userId: input.userId,
      promptVersion: ONBOARDING_PROPOSAL_PROMPT_VERSION,
      instructions: reduceLoad
        ? ONBOARDING_INSTRUCTIONS + ONBOARDING_REDUCE_INSTRUCTIONS
        : ONBOARDING_INSTRUCTIONS,
      input: JSON.stringify({
        today: localDate(input.guardrails.now, input.guardrails.timezone),
        timezone: input.guardrails.timezone,
        answers: input.answers,
        // Present ONLY on a reduce pass. A `reduceLoad: false` key in every
        // request would be a flag the model has to read past on the happy path.
        ...(reduceLoad
          ? { reduceLoad: true, previousProposal: input.previousProposal }
          : {}),
      }),
      schema: onboardingProposalSchema,
      schemaName: ONBOARDING_PROPOSAL_SCHEMA_NAME,
      requestId: input.requestId,
    });

    if (!result.ok) {
      // The one AI failure the USER can fix. Everything else is the server's
      // problem, and the wizard answers it with "Continue without AI".
      if (result.error.code === 'no_user_key') throw new AiKeyRequiredException();

      throw unavailable(result.error.code, result.error.message);
    }

    const rules = validateOnboardingProposal(result.output, input.guardrails);

    if (rules.length > 0) {
      this.logger.warn(
        `Onboarding proposal guardrails rejected user=${input.userId} rules=${rules.length}`,
      );

      throw unavailable('schema', 'The coach produced a plan that does not fit your week.');
    }

    return { proposal: result.output, invocationId: result.invocationId };
  }
}

/**
 * 503 with `details.reason: 'AI_UNAVAILABLE'` and a `retryable` the client
 * branches on.
 *
 * The envelope shape E07 established: `HttpExceptionFilter` rewrites the
 * top-level `code` from the status, so the discriminator lives in `details`
 * where it survives. The wizard's two recovery buttons — try again, or continue
 * without AI — are chosen by `retryable`.
 */
export function unavailable(code: AiErrorCode, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message,
    details: { reason: 'AI_UNAVAILABLE', code, retryable: RETRYABLE.has(code) },
  });
}
