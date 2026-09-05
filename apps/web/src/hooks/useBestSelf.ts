import { useCallback, useEffect, useState } from 'react';

import type { BestSelfInput, BestSelfProfile } from '../types';
import { getBestSelf, putBestSelf } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseBestSelfResult {
  /** `null` means "never saved", which is an empty card rather than an error. */
  profile: BestSelfProfile | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (input: BestSelfInput) => Promise<BestSelfProfile>;
}

export function useBestSelf(): UseBestSelfResult {
  const [profile, setProfile] = useState<BestSelfProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Every setState past an await is guarded: a request that settles after the
  // component is gone must not schedule an update on it.
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getBestSelf();
      if (isMounted()) setProfile(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load your Best Self';
      if (isMounted()) setError(message);
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  const save = useCallback(
    async (input: BestSelfInput): Promise<BestSelfProfile> => {
      setError(null);
      try {
        const saved = await putBestSelf(input);
        // The response IS the new state, so this does not refetch — one round
        // trip, and no window where the card shows the old text.
        if (isMounted()) setProfile(saved);
        return saved;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save your Best Self';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [isMounted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, isLoading, error, refresh, save };
}
