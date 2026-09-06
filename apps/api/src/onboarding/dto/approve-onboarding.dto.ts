import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The approval body (issue #101, epic E04).
 *
 * THE WHOLE PROPOSAL, not a proposal id and a diff: the user may have edited
 * it, and the copy they are approving is the copy that must be persisted.
 * `source` is deliberately absent — it is read off the stored row, because a
 * client claiming `'ai'` would put the coach's name on a plan it never wrote.
 *
 * -----------------------------------------------------------------------------
 * WHY THE PROPOSAL IS UNTYPED HERE
 * -----------------------------------------------------------------------------
 * `onboardingProposalSchema` is applied by `OnboardingService.approve`, not by
 * this pipe, and that is deliberate: the pipe answers a contract violation with
 * a generic 400, while the service answers it with `PROPOSAL_INVALID` and a
 * `details.rules[]` the review screen renders under the offending section. A
 * plan with four behaviours and a plan scheduled a month out are the same kind
 * of mistake to the person who made it, and they get the same answer.
 *
 * The shape is still documented — see the `Onboarding` tag's schema — and it is
 * still enforced; it is enforced one layer in, where the error can be useful.
 */
export const approveOnboardingSchema = z.object({
  proposal: z.looseObject({}),
});

export class ApproveOnboardingDto extends createZodDto(approveOnboardingSchema) {}
