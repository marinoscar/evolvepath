import { useCallback, useEffect, useState } from 'react';

import type {
  ApprovedOnboardingPath,
  OnboardingAnswersPatch,
  OnboardingConfidenceResult,
  OnboardingProposal,
  OnboardingProposalResult,
  OnboardingState,
  OnboardingStep,
} from '../types';
import {
  approveOnboarding,
  getOnboardingState,
  patchOnboardingAnswers,
  proposeOnboarding,
  skipOnboardingAi,
  startOnboarding,
  submitOnboardingConfidence,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

// =============================================================================
// The wizard's state (issue #102, epic E04)
// =============================================================================
//
// THE SERVER IS THE ONLY STORE. Nothing here touches `localStorage` or
// `sessionStorage`: PRD §19 gives onboarding five to eight minutes on a phone,
// a phone locks, and the answer to "where was I?" has to survive a different
// device as well as a different tab. It also means a half-finished wizard is
// visible to the API — which is the point of `user_profiles.onboarding_step`.
//
// SAVES ARE OPTIMISTIC AND REVERT. The step advances the moment the user
// presses Next, because a spinner between every screen turns eight minutes into
// twelve; a failed PATCH puts them back on the step they were on with the error
// beside the button, rather than leaving them one screen ahead of what was
// saved.
// =============================================================================

interface UseOnboardingResult {
  state: OnboardingState | null;
  /** The step the wizard is SHOWING, which leads `state.step` while a save is in flight. */
  step: OnboardingStep;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  /** Moves the wizard back one screen without a PATCH — the answers are already saved. */
  goTo: (step: OnboardingStep) => void;
  start: (timezone: string, locale?: string) => Promise<void>;
  saveAnswers: (patch: OnboardingAnswersPatch) => Promise<void>;
  propose: () => Promise<OnboardingProposalResult>;
  skipAi: () => Promise<OnboardingProposalResult>;
  submitConfidence: (score: number) => Promise<OnboardingConfidenceResult>;
  approve: (proposal: OnboardingProposal) => Promise<ApprovedOnboardingPath>;
}

/** Raised when the account is already onboarded; the page navigates to `/`. */
export const ONBOARDING_COMPLETED_CODE = 'ONBOARDING_ALREADY_COMPLETED';

export function useOnboarding(): UseOnboardingResult {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingStep>('PROMISE');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await getOnboardingState();
      if (!isMounted()) return;
      setState(next);
      setStep(next.step);
    } catch (err) {
      if (isMounted()) setError(messageOf(err, 'Could not load where you left off.'));
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearError = useCallback(() => setError(null), []);

  const goTo = useCallback((next: OnboardingStep) => {
    setError(null);
    setStep(next);
  }, []);

  const start = useCallback(
    async (timezone: string, locale?: string) => {
      const previous = step;
      setStep('VISION');
      setIsSaving(true);
      setError(null);
      try {
        const next = await startOnboarding({ timezone, ...(locale ? { locale } : {}) });
        if (isMounted()) setState(next);
      } catch (err) {
        if (isMounted()) {
          setStep(previous);
          setError(messageOf(err, 'Could not start. Try again.'));
        }
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [isMounted, step],
  );

  const saveAnswers = useCallback(
    async (patch: OnboardingAnswersPatch) => {
      const previous = step;

      // Optimistic: the screen the user asked for renders immediately, and the
      // revert below is the only thing that can take it away.
      if (patch.step) setStep(patch.step);
      setIsSaving(true);
      setError(null);

      try {
        const next = await patchOnboardingAnswers(patch);
        if (isMounted()) setState(next);
      } catch (err) {
        if (isMounted()) {
          setStep(previous);
          setError(messageOf(err, 'Could not save that. Try again.'));
        }
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [isMounted, step],
  );

  /**
   * The three proposal calls share one shape: they return their result to the
   * caller (the review screen renders it) AND fold it into `state`, so a
   * remount of the wizard finds the same proposal without a second request.
   */
  const runProposal = useCallback(
    async <T extends OnboardingProposalResult>(call: () => Promise<T>): Promise<T> => {
      const result = await call();

      if (isMounted()) {
        setState((current) =>
          current
            ? {
                ...current,
                step: 'PROPOSAL',
                pendingProposal: result.proposal,
                proposalSource: result.source,
              }
            : current,
        );
      }

      return result;
    },
    [isMounted],
  );

  // NO `setError` ON THESE THREE. The review screen has distinct, actionable UI
  // for 412, 503 and 400 — a shared inline alert would flatten "the coach is
  // unavailable, continue without it" into the same sentence as "that did not
  // save".
  const propose = useCallback(() => runProposal(proposeOnboarding), [runProposal]);

  const skipAi = useCallback(() => runProposal(skipOnboardingAi), [runProposal]);

  const submitConfidence = useCallback(
    (score: number) =>
      runProposal(() => submitOnboardingConfidence(score)).then((result) => {
        if (isMounted()) {
          setState((current) => (current ? { ...current, confidenceScore: score } : current));
        }
        return result;
      }),
    [isMounted, runProposal],
  );

  const approve = useCallback(
    async (proposal: OnboardingProposal) => {
      const created = await approveOnboarding(proposal);

      if (isMounted()) {
        // The API has already set `DONE`; reflecting it here keeps the wizard's
        // own guard honest without a refetch. The step does NOT advance to
        // `DONE` — step 9 still has to render.
        setState((current) =>
          current ? { ...current, completed: true, pendingProposal: null } : current,
        );
      }

      return created;
    },
    [isMounted],
  );

  return {
    state,
    step,
    isLoading,
    isSaving,
    error,
    clearError,
    refresh,
    goTo,
    start,
    saveAnswers,
    propose,
    skipAi,
    submitConfidence,
    approve,
  };
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
