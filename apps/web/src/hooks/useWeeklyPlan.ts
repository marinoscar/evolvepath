import { useCallback, useEffect, useState } from 'react';

import type {
  ApproveWeeklyPlanResult,
  ExtraCommitment,
  LoadWarning,
  WeeklyDomainModes,
  WeeklyPlanConstraints,
  WeeklyPlanDetail,
} from '../types';
import {
  approveWeeklyPlan,
  createWeeklyPlan,
  getWeeklyPlan,
  proposeWeeklyPlan,
  updateWeeklyPlan,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

export interface WeeklyPlanPatch {
  constraints?: WeeklyPlanConstraints;
  primaryFocus?: string | null;
  domainModes?: WeeklyDomainModes;
}

interface UseWeeklyPlanResult {
  plan: WeeklyPlanDetail | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  warnings: LoadWarning[];
  update: (patch: WeeklyPlanPatch) => Promise<void>;
  propose: (extras?: ExtraCommitment[]) => Promise<void>;
  approve: (acknowledgeWarnings: boolean) => Promise<ApproveWeeklyPlanResult | null>;
}

/**
 * The planning wizard's draft (issue #84, epic E10).
 *
 * Creates the draft on mount, which is safe because `POST /weekly/plans` is
 * idempotent server-side — a refresh mid-wizard resumes the same week rather
 * than forking it.
 *
 * EVERY STEP PERSISTS BEFORE ADVANCING, and the response replaces local state
 * rather than being merged into it. That is what makes closing the tab on step
 * three cost nothing, and it is also why the commitments step always shows
 * what the API computed rather than a client-side re-derivation of it.
 */
export function useWeeklyPlan(planId?: string): UseWeeklyPlanResult {
  const [plan, setPlan] = useState<WeeklyPlanDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const found = planId ? await getWeeklyPlan(planId) : await createWeeklyPlan({});
        if (isMounted()) setPlan(found);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not open next week';
        if (isMounted()) setError(message);
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    })();
  }, [planId, isMounted]);

  const run = useCallback(
    async <T,>(work: (id: string) => Promise<T>, failure: string): Promise<T | null> => {
      if (!plan) return null;
      setIsSaving(true);
      setError(null);
      try {
        return await work(plan.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : failure;
        if (isMounted()) setError(message);
        return null;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [plan, isMounted],
  );

  const update = useCallback(
    async (patch: WeeklyPlanPatch) => {
      const saved = await run(
        (id) => updateWeeklyPlan(id, patch),
        'Could not save that step',
      );
      if (saved && isMounted()) setPlan(saved);
    },
    [run, isMounted],
  );

  const propose = useCallback(
    async (extras?: ExtraCommitment[]) => {
      const proposed = await run(
        (id) => proposeWeeklyPlan(id, { extras: extras ?? [] }),
        'Could not work out next week',
      );
      if (proposed && isMounted()) setPlan(proposed);
    },
    [run, isMounted],
  );

  const approve = useCallback(
    async (acknowledgeWarnings: boolean) => {
      const result = await run(
        (id) => approveWeeklyPlan(id, { acknowledgeWarnings }),
        'Could not approve next week',
      );
      if (result && isMounted()) setPlan(result.plan);
      return result;
    },
    [run, isMounted],
  );

  return {
    plan,
    isLoading,
    isSaving,
    error,
    // Read off the plan rather than held separately: a stale warning list is
    // exactly what would let the acknowledge checkbox disagree with the server.
    warnings: plan?.proposal?.warnings ?? [],
    update,
    propose,
    approve,
  };
}
