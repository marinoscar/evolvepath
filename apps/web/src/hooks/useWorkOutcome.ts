import { useCallback, useEffect, useState } from 'react';

import type { FocusSession, OutcomeWorkPlan } from '../types';
import { getOutcomeWorkPlan, listFocusSessions } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseWorkOutcomeResult {
  plan: OutcomeWorkPlan | null;
  sessions: FocusSession[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** How far back the session history reaches. A month is a readable list. */
const HISTORY_DAYS = 30;

/**
 * A work outcome's milestones, planned sessions and recent focus history
 * (epic E07, PRD §24).
 *
 * Both reads happen together and are refetched together after an apply, because
 * applying a plan changes both — a spliced-in session list would be this app's
 * second, wrong implementation of the API's ordering.
 */
export function useWorkOutcome(outcomeId: string | undefined): UseWorkOutcomeResult {
  const [plan, setPlan] = useState<OutcomeWorkPlan | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    if (!outcomeId) return;

    setError(null);

    try {
      const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();

      const [loadedPlan, history] = await Promise.all([
        getOutcomeWorkPlan(outcomeId),
        listFocusSessions({ outcomeId, from }),
      ]);

      if (!isMounted()) return;

      setPlan(loadedPlan);
      setSessions(history.sessions);
    } catch (err) {
      if (!isMounted()) return;
      setError(err instanceof Error ? err.message : 'Could not load the work plan');
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [outcomeId, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { plan, sessions, isLoading, error, refresh };
}
