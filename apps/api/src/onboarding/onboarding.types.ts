import type { CoachingStyle, OnboardingStep } from '@prisma/client';

import type {
  DomainReflections,
  HealthBaseline,
  ObstacleOption,
} from '../user-profile/user-profile.schema';
import type { OnboardingProposal, ProposalDomain } from './onboarding-proposal.schema';

// =============================================================================
// What the wizard reads and what the planner is told (issue #101, epic E04)
// =============================================================================
//
// `OnboardingAnswers` is BOTH: the client renders it back into the steps a
// returning user already filled in, and it is serialised verbatim into the
// planner's input. One shape, so a question that is asked is a question the
// coach can see, and there is no third place where the two could drift.
// =============================================================================

export interface OnboardingAnswers {
  sixMonthVision: string | null;
  domains: ProposalDomain[];
  domainReflections: DomainReflections | null;
  obstacles: ObstacleOption[];
  weekdayMinutes: number | null;
  healthBaseline: HealthBaseline | null;
  coachingStyle: CoachingStyle;
}

export interface OnboardingState {
  step: OnboardingStep;
  completed: boolean;
  answers: OnboardingAnswers;
  /**
   * The proposal waiting on the user, or null.
   *
   * ON THE PROFILE ROW, not in the domain tables with a `draft` flag — see
   * `docs/specs/onboarding.md` for why. Nothing in `outcomes`, `plans`,
   * `routines` or `commitments` exists until approve (PRD §15).
   */
  pendingProposal: OnboardingProposal | null;
  /** Where the pending proposal came from. Read off the row, never the body. */
  proposalSource: 'ai' | 'template' | null;
  confidenceScore: number | null;
}

export interface ProposalResponse {
  proposal: OnboardingProposal;
  source: 'ai' | 'template';
}

export interface ConfidenceResponse extends ProposalResponse {
  /** Whether the answer was low enough to replace the plan (PRD §72). */
  reproposed: boolean;
}

export interface ApprovedPath {
  bestSelfId: string;
  outcomeIds: string[];
  planVersionIds: string[];
  routineIds: string[];
  commitmentIds: string[];
}
