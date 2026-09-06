import { forwardRef } from 'react';
import { Alert } from '@mui/material';

import type {
  ApprovedOnboardingPath,
  OnboardingConfidenceResult,
  OnboardingProposal,
  OnboardingProposalResult,
  OnboardingProposalSource,
} from '../../types';
import { PROPOSAL_TITLE } from './copy';
import { StepShell } from './StepShell';

/**
 * Step 8 — PLACEHOLDER (issue #102, epic E04).
 *
 * The review screen is E04-04 (#104): the Best Self card, one section per
 * domain, inline commitment edits, the confidence question and `Start this
 * Path`. This file exists so the wizard's nine steps are all reachable and the
 * page's prop wiring is real rather than invented later; #104 replaces the body
 * and keeps this exact prop contract.
 */
export interface ProposalStepProps {
  pendingProposal: OnboardingProposal | null;
  proposalSource: OnboardingProposalSource | null;
  onPropose: () => Promise<OnboardingProposalResult>;
  onSkipAi: () => Promise<OnboardingProposalResult>;
  onSubmitConfidence: (score: number) => Promise<OnboardingConfidenceResult>;
  onApprove: (proposal: OnboardingProposal) => Promise<ApprovedOnboardingPath>;
  onApproved: () => void;
  onAlreadyCompleted: () => void;
}

export const ProposalStep = forwardRef<HTMLHeadingElement, ProposalStepProps>(
  function ProposalStep(_props, ref) {
    return (
      <StepShell ref={ref} title={PROPOSAL_TITLE}>
        <Alert severity="info">
          The plan review screen arrives with E04-04. Your answers are saved.
        </Alert>
      </StepShell>
    );
  },
);
