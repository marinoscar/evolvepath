import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { onboardingProposalSchema } from '../onboarding-proposal.schema';

/**
 * The approval body (issue #101, epic E04).
 *
 * THE WHOLE PROPOSAL, not a proposal id and a diff: the user may have edited
 * it, and the copy they are approving is the copy that must be persisted.
 * `source` is deliberately absent — it is read off the stored row, because a
 * client claiming `'ai'` would put the coach's name on a plan it never wrote.
 */
export const approveOnboardingSchema = z.object({
  proposal: onboardingProposalSchema,
});

export class ApproveOnboardingDto extends createZodDto(approveOnboardingSchema) {}
