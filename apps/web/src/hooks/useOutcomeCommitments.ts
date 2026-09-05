import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Commitment, CommitmentInput, TransitionInput, TransitionResult } from '../types';
import { createCommitment, getCommitments, transitionCommitment } from '../services/api';
import { useIsMounted } from './useIsMounted';

/** Today through a fortnight out — the horizon the detail page plans over. */
const WINDOW_DAYS = 14;

interface UseOutcomeCommitmentsResult {
  commitments: Commitment[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  add: (input: CommitmentInput) => Promise<Commitment>;
  transition: (id: string, input: TransitionInput) => Promise<TransitionResult>;
}

export function useOutcomeCommitments(outcomeId: string | undefined): UseOutcomeCommitmentsResult {
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  // Recomputed once per mount, not per render: a window whose bounds moved on
  // every render would make `refresh` a new function every time and loop the
  // effect below forever.
  const window = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + WINDOW_DAYS);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const refresh = useCallback(async () => {
    if (!outcomeId) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await getCommitments({ ...window, outcomeId });
      if (isMounted()) setCommitments(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load commitments';
      if (isMounted()) {
        setError(message);
        setCommitments([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [outcomeId, window, isMounted]);

  const add = useCallback(
    async (input: CommitmentInput) => {
      setError(null);
      try {
        const created = await createCommitment(input);
        await refresh();
        return created;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add the commitment';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [refresh, isMounted],
  );

  const transition = useCallback(
    async (id: string, input: TransitionInput) => {
      setError(null);
      try {
        const result = await transitionCommitment(id, input);
        // A reschedule closes one row and opens another, so the list has to be
        // refetched rather than patched — and the new row may fall outside the
        // window, in which case it correctly does not appear.
        await refresh();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to change the status';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [refresh, isMounted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { commitments, isLoading, error, refresh, add, transition };
}
