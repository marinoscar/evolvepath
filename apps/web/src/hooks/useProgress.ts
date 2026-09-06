import { useCallback, useEffect, useState } from 'react';

import type { ProgressResponse } from '../types';
import { getProgress } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseProgressResult {
  progress: ProgressResponse | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * The Progress screen's one read (issue #117, epic E11).
 *
 * Refetches on window focus for the same reason `useToday` does: this is a
 * screen people leave open and come back to after completing something on a
 * phone, and a momentum card that still says "Slipping" after they fixed it is
 * worse than no card.
 */
export function useProgress(): UseProgressResult {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const result = await getProgress();
      if (isMounted()) setProgress(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load progress';
      if (isMounted()) setError(message);
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return { progress, isLoading, error, refresh };
}
