import { useCallback, useEffect, useState } from 'react';

import type { NutritionBehaviour } from '../types';
import { commitNutritionBehaviour, listNutritionBehaviours } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseNutritionBehavioursResult {
  behaviours: NutritionBehaviour[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  commit: (key: string, repeatDays?: number) => Promise<number>;
}

/**
 * The registry, and the one action you can take on it.
 *
 * `commit` does not refetch: the registry is static, and what changes is the
 * user's Today screen — which this hook has no business owning.
 */
export function useNutritionBehaviours(): UseNutritionBehavioursResult {
  const [behaviours, setBehaviours] = useState<NutritionBehaviour[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listNutritionBehaviours();
      if (isMounted()) setBehaviours(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load behaviours';
      if (isMounted()) {
        setError(message);
        setBehaviours([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const commit = useCallback(async (key: string, repeatDays = 1) => {
    const result = await commitNutritionBehaviour(key, { repeatDays });
    return result.commitmentIds.length;
  }, []);

  return { behaviours, isLoading, error, refresh, commit };
}
