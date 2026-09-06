import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Skeleton,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import type {
  ApprovedOnboardingPath,
  Domain,
  OnboardingConfidenceResult,
  OnboardingProposal,
  OnboardingProposalCommitment,
  OnboardingProposalResult,
  OnboardingProposalSource,
} from '../../types';
import { ApiError } from '../../services/api';
import { ConfidenceQuestion } from './ConfidenceQuestion';
import { ProposalSection } from './ProposalSection';
import { StepShell } from './StepShell';
import {
  CONFIDENCE_REDUCED_SNACKBAR,
  PROPOSAL_ADJUST,
  PROPOSAL_AI_UNAVAILABLE,
  PROPOSAL_APPROVE,
  PROPOSAL_DONE_ADJUSTING,
  PROPOSAL_LOADING,
  PROPOSAL_REDUCED_SENTENCE,
  PROPOSAL_RETRY,
  PROPOSAL_SKIP_AI,
  PROPOSAL_TEMPLATE_CHIP,
  PROPOSAL_TITLE,
} from './copy';

// =============================================================================
// Step 8 — "Your first Path" (issue #104, epic E04)
// =============================================================================
//
// The one screen in this flow where the user is agreeing to something, so it is
// the one screen where every failure needs its OWN answer rather than a shared
// alert:
//
//   • 503 — the coach is down. Two buttons: try again, or continue without it.
//     PRD §120 means the second one has to finish the flow, not apologise.
//   • 412 — no key. Rare (the gate should have caught it), and the only useful
//     thing to render is a link to fix it.
//   • 400 `PROPOSAL_INVALID` — the edit broke a rule. The server's sentences go
//     UNDER the section they are about, not into a toast.
//   • 409 — already onboarded. Somebody raced two submits; go home.
//
// EDITS ARE LOCAL UNTIL APPROVE. There is no autosave here: a half-edited plan
// is not a plan anybody agreed to, and `POST /onboarding/approve` takes the
// whole proposal precisely so the copy the user is looking at is the copy that
// gets persisted.
// =============================================================================

const DOMAIN_ORDER: Domain[] = ['WORK', 'FAMILY', 'HEALTH'];

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

type LoadFailure =
  | { kind: 'unavailable'; message: string; retryable: boolean }
  | { kind: 'no-key' }
  | { kind: 'other'; message: string };

export const ProposalStep = forwardRef<HTMLHeadingElement, ProposalStepProps>(
  function ProposalStep(
    {
      pendingProposal,
      proposalSource,
      onPropose,
      onSkipAi,
      onSubmitConfidence,
      onApprove,
      onApproved,
      onAlreadyCompleted,
    },
    ref,
  ) {
    const [proposal, setProposal] = useState<OnboardingProposal | null>(pendingProposal);
    const [source, setSource] = useState<OnboardingProposalSource | null>(proposalSource);
    const [isLoading, setIsLoading] = useState(false);
    const [failure, setFailure] = useState<LoadFailure | null>(null);
    const [editing, setEditing] = useState(false);
    const [confidence, setConfidence] = useState<number | null>(null);
    const [isSubmittingConfidence, setIsSubmittingConfidence] = useState(false);
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [isApproving, setIsApproving] = useState(false);
    const [approveProblems, setApproveProblems] = useState<string[]>([]);
    const [approveError, setApproveError] = useState<string | null>(null);

    // Guards the mount effect against React's double-invoke in development and
    // against a re-render while the first request is still open. Without it the
    // user's key pays for two plans.
    const requested = useRef(false);

    const load = useCallback(
      async (call: () => Promise<OnboardingProposalResult>) => {
        setIsLoading(true);
        setFailure(null);
        try {
          const result = await call();
          setProposal(result.proposal);
          setSource(result.source);
        } catch (error) {
          setFailure(classify(error));
        } finally {
          setIsLoading(false);
        }
      },
      [],
    );

    useEffect(() => {
      if (proposal || requested.current) return;

      requested.current = true;
      void load(onPropose);
    }, [load, onPropose, proposal]);

    // ---- the editable copy -------------------------------------------------

    const commitments = proposal?.firstWeekCommitments ?? [];

    const patchCommitment = useCallback(
      (globalIndex: number, next: OnboardingProposalCommitment) => {
        setProposal((current) =>
          current
            ? {
                ...current,
                firstWeekCommitments: current.firstWeekCommitments.map((c, i) =>
                  i === globalIndex ? next : c,
                ),
              }
            : current,
        );
      },
      [],
    );

    const removeCommitment = useCallback((globalIndex: number) => {
      setProposal((current) =>
        current
          ? {
              ...current,
              firstWeekCommitments: current.firstWeekCommitments.filter(
                (_c, i) => i !== globalIndex,
              ),
            }
          : current,
      );
    }, []);

    const bounds = useMemo(datetimeBounds, []);

    // ---- confidence --------------------------------------------------------

    const handleConfidence = useCallback(
      async (score: number) => {
        setConfidence(score);
        setIsSubmittingConfidence(true);
        setApproveProblems([]);
        try {
          const result = await onSubmitConfidence(score);

          if (result.reproposed) {
            // The local edits are DISCARDED, and the snackbar says so. Merging
            // them into a plan the coach deliberately made smaller would undo
            // the reduction the user just asked for.
            setProposal(result.proposal);
            setSource(result.source);
            setEditing(false);
            setSnackbarOpen(true);
          }
        } catch (error) {
          setFailure(classify(error));
        } finally {
          setIsSubmittingConfidence(false);
        }
      },
      [onSubmitConfidence],
    );

    // ---- approve -----------------------------------------------------------

    const handleApprove = useCallback(async () => {
      if (!proposal) return;

      setIsApproving(true);
      setApproveProblems([]);
      setApproveError(null);
      try {
        await onApprove(proposal);
        onApproved();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          onAlreadyCompleted();
          return;
        }

        const rules = rulesOf(error);

        if (rules.length > 0) {
          setApproveProblems(rules);
        } else {
          setApproveError(error instanceof Error ? error.message : 'Could not start this Path.');
        }
      } finally {
        setIsApproving(false);
      }
    }, [onAlreadyCompleted, onApprove, onApproved, proposal]);

    // ---- rendering ---------------------------------------------------------

    if (isLoading && !proposal) {
      return (
        <StepShell ref={ref} title={PROPOSAL_TITLE}>
          <Box aria-busy="true" aria-live="polite">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {PROPOSAL_LOADING}
            </Typography>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </Box>
        </StepShell>
      );
    }

    if (!proposal && failure) {
      return (
        <StepShell ref={ref} title={PROPOSAL_TITLE}>
          {failure.kind === 'no-key' ? (
            <Alert severity="warning">
              This step needs your own OpenAI key.{' '}
              <RouterLink to="/settings/ai-key">Add one</RouterLink>, or continue without it.
            </Alert>
          ) : (
            <Alert severity="warning">
              {failure.kind === 'unavailable' ? PROPOSAL_AI_UNAVAILABLE : failure.message}
            </Alert>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            {failure.kind !== 'no-key' && (
              <Button variant="outlined" onClick={() => void load(onPropose)}>
                {PROPOSAL_RETRY}
              </Button>
            )}
            <Button variant="contained" onClick={() => void load(onSkipAi)}>
              {PROPOSAL_SKIP_AI}
            </Button>
          </Stack>
        </StepShell>
      );
    }

    if (!proposal) {
      return (
        <StepShell ref={ref} title={PROPOSAL_TITLE}>
          <Skeleton height={48} />
        </StepShell>
      );
    }

    const domains = DOMAIN_ORDER.filter((domain) =>
      proposal.outcomes.some((o) => o.domain === domain) ||
      proposal.firstWeekCommitments.some((c) => c.domain === domain),
    );

    return (
      <StepShell ref={ref} title={PROPOSAL_TITLE}>
        {source === 'template' && (
          <Box>
            <Chip label={PROPOSAL_TEMPLATE_CHIP} size="small" variant="outlined" />
          </Box>
        )}

        <Box>
          <Typography variant="h6" component="p">
            {proposal.bestSelf.identityStatement}
          </Typography>
          {[
            proposal.bestSelf.workIdentity,
            proposal.bestSelf.familyIdentity,
            proposal.bestSelf.healthIdentity,
          ]
            .filter((line): line is string => Boolean(line))
            .map((line) => (
              <Typography key={line} variant="body2" color="text.secondary">
                {line}
              </Typography>
            ))}
        </Box>

        <Divider />

        <Box aria-live="polite">
          <Stack spacing={3} divider={<Divider />}>
            {domains.map((domain) => (
              <ProposalSection
                key={domain}
                domain={domain}
                outcome={proposal.outcomes.find((o) => o.domain === domain) ?? null}
                routines={proposal.routines.filter((r) => r.domain === domain)}
                commitments={commitments.filter((c) => c.domain === domain)}
                editing={editing}
                problems={approveProblems.filter((rule) => rule.includes(domain))}
                min={bounds.min}
                max={bounds.max}
                canRemoveCommitment={commitments.length > 1}
                onCommitmentChange={(localIndex, next) =>
                  patchCommitment(globalIndexOf(commitments, domain, localIndex), next)
                }
                onCommitmentRemove={(localIndex) =>
                  removeCommitment(globalIndexOf(commitments, domain, localIndex))
                }
              />
            ))}
          </Stack>
        </Box>

        <Box component="blockquote" sx={{ m: 0, pl: 2, borderLeft: 3, borderColor: 'divider' }}>
          {proposal.reducedFromRequest && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {PROPOSAL_REDUCED_SENTENCE}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {proposal.rationale}
          </Typography>
        </Box>

        {/* Rules the server returned that name no domain — a day over capacity,
            for instance — have no section to sit under, so they go here rather
            than nowhere. */}
        {approveProblems.filter((rule) => !DOMAIN_ORDER.some((d) => rule.includes(d))).length >
          0 && (
          <Alert severity="error">
            <Stack spacing={0.5}>
              {approveProblems
                .filter((rule) => !DOMAIN_ORDER.some((d) => rule.includes(d)))
                .map((rule) => (
                  <span key={rule}>{rule}</span>
                ))}
            </Stack>
          </Alert>
        )}

        {approveError && <Alert severity="error">{approveError}</Alert>}

        <Divider />

        <ConfidenceQuestion
          value={confidence}
          disabled={isSubmittingConfidence}
          onChange={(score) => void handleConfidence(score)}
        />

        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5}>
          <Button variant="outlined" onClick={() => setEditing((current) => !current)}>
            {editing ? PROPOSAL_DONE_ADJUSTING : PROPOSAL_ADJUST}
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleApprove()}
            disabled={confidence == null || isApproving || isSubmittingConfidence}
            sx={{ flex: 1 }}
          >
            {PROPOSAL_APPROVE}
          </Button>
        </Stack>

        <Snackbar
          open={snackbarOpen}
          autoHideDuration={6000}
          onClose={() => setSnackbarOpen(false)}
          message={CONFIDENCE_REDUCED_SNACKBAR}
        />
      </StepShell>
    );
  },
);

/** The position in the whole list of the n-th commitment in one domain. */
function globalIndexOf(
  commitments: OnboardingProposalCommitment[],
  domain: Domain,
  localIndex: number,
): number {
  let seen = -1;

  for (let i = 0; i < commitments.length; i += 1) {
    if (commitments[i].domain !== domain) continue;
    seen += 1;
    if (seen === localIndex) return i;
  }

  return -1;
}

/** `datetime-local` bounds for the first week, in the browser's own zone. */
function datetimeBounds(): { min: string; max: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const format = (at: Date) =>
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;

  return {
    min: format(new Date(now.getTime() - 24 * 3_600_000)),
    max: format(new Date(now.getTime() + 7 * 24 * 3_600_000)),
  };
}

function classify(error: unknown): LoadFailure {
  if (error instanceof ApiError) {
    if (error.status === 412) return { kind: 'no-key' };

    if (error.status === 503) {
      const details = error.details as { retryable?: boolean } | undefined;
      return {
        kind: 'unavailable',
        message: error.message,
        retryable: details?.retryable ?? true,
      };
    }
  }

  return {
    kind: 'other',
    message: error instanceof Error ? error.message : 'Could not build a plan.',
  };
}

/** The `details.rules[]` a 400 `PROPOSAL_INVALID` carries, or an empty list. */
function rulesOf(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 400) return [];

  const details = error.details as { reason?: string; rules?: unknown } | undefined;

  if (details?.reason !== 'PROPOSAL_INVALID' || !Array.isArray(details.rules)) return [];

  return details.rules.filter((rule): rule is string => typeof rule === 'string');
}
