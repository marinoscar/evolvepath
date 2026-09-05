import { useCallback, useEffect, useState } from 'react';

import type { BodyWeightLog, WeightTrend } from '../types';
import { deleteWeight, getWeight, putWeight } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseWeightLogResult {
  trend: WeightTrend | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (entry: BodyWeightLog) => Promise<void>;
  remove: (dateLocal: string) => Promise<void>;
}

/**
 * The last thirty days and the line through them.
 *
 * Mutations REFETCH rather than splicing: the rolling mean is computed on the
 * server, and recomputing it here after a save would be a second implementation
 * of PRD §47's window — which is exactly the kind of arithmetic that is wrong
 * in interesting ways at month boundaries.
 */
export function useWeightLog(): UseWeightLogResult {
  const [trend, setTrend] = useState<WeightTrend | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getWeight();
      if (isMounted()) setTrend(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load your weight log';
      if (isMounted()) {
        setError(message);
        setTrend(null);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (entry: BodyWeightLog) => {
      await putWeight(entry);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (dateLocal: string) => {
      await deleteWeight(dateLocal);
      await refresh();
    },
    [refresh],
  );

  return { trend, isLoading, error, refresh, save, remove };
}
