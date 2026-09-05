import { Injectable, Logger } from '@nestjs/common';
import type { Commitment } from '@prisma/client';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { versionsOf } from '../commitment-card.mapper';
import {
  DECOMPOSITION_SCHEMA_NAME,
  decompositionProposalSchema,
  templateProposal,
  type DecompositionProposal,
} from './decomposition.schema';

/** Bumped whenever the instructions below change meaningfully (PRD §117). */
export const DECOMPOSITION_PROMPT_VERSION = 'decompose.v1';

/**
 * How direct the coach is, in the coach's own words.
 *
 * Read from `user_profiles.coachingStyle` (#100) rather than guessed: PRD §20
 * step 7 asks the user for this explicitly, and answering it and then being
 * spoken to in a different register is worse than never being asked.
 */
const STYLE_INSTRUCTIONS: Record<string, string> = {
  GENTLE: 'Be warm and unhurried. Never imply the user is behind.',
  BALANCED: 'Be plain and encouraging. No cheerleading, no lecturing.',
  DIRECT: 'Be brief and concrete. Skip the encouragement and name the next move.',
};

/**
 * The decomposition prompt.
 *
 * Says what the output is FOR, because the failure mode of a "break this down"
 * prompt is a model that plans the whole project. The size bounds are also
 * enforced by the schema, but stating them here is what makes the model produce
 * something usable rather than something that fails validation.
 */
export function buildDecompositionInstructions(coachingStyle: string): string {
  return [
    'You help someone start a task they are avoiding.',
    'Break the commitment into 3 to 5 concrete steps, in order.',
    'The first step must take 10 minutes or less and must be something the user can do immediately, without preparing anything.',
    'Do not add new goals, new commitments, or advice about the plan.',
    'Use the user’s own words for the work where you can.',
    STYLE_INSTRUCTIONS[coachingStyle] ?? STYLE_INSTRUCTIONS.BALANCED,
    'Write `message` as one sentence to the user about the first step.',
    'Set `source` to "ai".',
  ].join(' ');
}

/**
 * "Break this down" (issue #40, epic E05).
 *
 * NEVER WRITES. `propose` returns something the user can accept, edit or
 * ignore; `CommitmentActionsService.applyDecomposition` is what persists. PRD
 * §15 is explicit that AI output is not persisted without user approval, and
 * separating the two services is how that stays true rather than remembered.
 */
@Injectable()
export class DecompositionService {
  private readonly logger = new Logger(DecompositionService.name);

  constructor(
    private readonly ai: AiGatewayService,
    private readonly userProfile: UserProfileService,
  ) {}

  async propose(
    userId: string,
    commitment: Commitment & { outcome?: { motivation: string | null } | null },
    hint?: string | null,
  ): Promise<DecompositionProposal> {
    const profile = await this.userProfile.find(userId);
    const versions = versionsOf(commitment);

    const input = JSON.stringify({
      title: commitment.title,
      domain: commitment.domain,
      versions,
      // E05's issues call this "whyItMatters"; E02 shipped the column as
      // `motivation` and that is the name in the schema. One field, one name.
      whyItMatters: commitment.outcome?.motivation ?? null,
      // How many times this has been moved is the single most useful signal
      // about WHY it has not happened, so the coach gets to see it.
      rescheduleCount: commitment.rescheduleCount,
      hint: hint ?? null,
    });

    const started = Date.now();

    const result = await this.ai.invoke({
      persona: 'coach',
      userId,
      promptVersion: DECOMPOSITION_PROMPT_VERSION,
      instructions: buildDecompositionInstructions(profile?.coachingStyle ?? 'BALANCED'),
      input,
      schema: decompositionProposalSchema,
      schemaName: DECOMPOSITION_SCHEMA_NAME,
    });

    if (!result.ok) {
      // PRD §120: branch, do not throw. `invoke` never rejects for a provider,
      // key, model or schema problem, so this is the only place the deterministic
      // path is chosen — and the user still gets a usable next move.
      this.logger.log(
        `commitment.decompose source=template reason=${result.error.code} latencyMs=${Date.now() - started}`,
      );

      return templateProposal();
    }

    this.logger.log(
      `commitment.decompose source=ai steps=${result.output.steps.length} latencyMs=${Date.now() - started}`,
    );

    // `source` is the server's fact, not the model's: a model that answered
    // `"template"` would make an AI proposal look like a fallback in telemetry.
    return { ...result.output, source: 'ai' };
  }
}
