import { useEffect, useState } from 'react';

import type { TodayInsight } from '../types';
import { getTodayInsight } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseTodayInsightResult {
  insight: TodayInsight | null;
  isLoading: boolean;
}

/**
 * The coach's sentence (epic E05, issue #46).
 *
 * A SEPARATE REQUEST, started only once the board has arrived. That ordering is
 * the point: the API guarantees `GET /today` never calls the provider, and this
 * hook is what keeps that guarantee useful — the page paints from the first
 * response, and a slow model delays one card rather than the screen.
 *
 * THERE IS NO ERROR STATE, and that is deliberate. The endpoint answers 200 with
 * a deterministic sentence when the coach is unavailable, so a failure here is a
 * transport problem: the card simply does not appear. Rendering an error box for
 * it would be the page reporting a problem the user cannot act on, next to a
 * recommendation that is perfectly usable.
 */
export function useTodayInsight(ready: boolean, key?: string): UseTodayInsightResult {
  const [insight, setInsight] = useState<TodayInsight | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useIsMounted();

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const result = await getTodayInsight();
        if (!cancelled && isMounted()) setInsight(result);
      } catch {
        if (!cancelled && isMounted()) setInsight(null);
      } finally {
        if (!cancelled && isMounted()) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, key, isMounted]);

  return { insight, isLoading };
}
