import { useCallback, useEffect, useState } from 'react';

import type { FamilySummary } from '../types';
import { getFamilySummary } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseFamilySummaryResult {
  summary: FamilySummary | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Planned versus kept, for the this-week panel.
 *
 * `weeks: 1` by default — the panel shows one week, and asking for four to
 * render one is four times the aggregation for nothing.
 */
export function useFamilySummary(weeks = 1): UseFamilySummaryResult {
  const [summary, setSummary] = useState<FamilySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getFamilySummary({ weeks });
      if (isMounted()) setSummary(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load this week';
      if (isMounted()) {
        setError(message);
        setSummary(null);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [weeks, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { summary, isLoading, error, refresh };
}
