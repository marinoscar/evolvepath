import { useCallback, useEffect, useState } from 'react';

import {
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
} from '../services/pushSubscriptions';
import type { PushState } from '../types';
import { useIsMounted } from './useIsMounted';

export interface UsePushSubscription {
  state: PushState;
  isBusy: boolean;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * The push switch's state and its two actions (issue #64, epic E12).
 *
 * Starts at `unsupported` rather than at a loading state: it is the truthful
 * answer for the majority of first renders (jsdom, an old browser, a server
 * with no keys), and it renders a disabled switch with an explanation rather
 * than a spinner that resolves into a disabled switch with an explanation.
 *
 * NOTHING HERE PROMPTS ON MOUNT. `getPushState` only observes; the prompt is
 * inside `subscribe`, which is reachable only from a click.
 */
export function usePushSubscription(): UsePushSubscription {
  const isMounted = useIsMounted();
  const [state, setState] = useState<PushState>('unsupported');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await getPushState();
    if (isMounted()) setState(next);
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<PushState>) => {
      setIsBusy(true);
      setError(null);
      try {
        const next = await action();
        if (isMounted()) setState(next);
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'Could not change push settings.');
          // Re-read rather than guess: a failed subscribe may still have left
          // the browser subscribed, and a switch that disagrees with the
          // browser is worse than one that took a moment to settle.
          await refresh();
        }
      } finally {
        if (isMounted()) setIsBusy(false);
      }
    },
    [isMounted, refresh],
  );

  return {
    state,
    isBusy,
    error,
    subscribe: useCallback(() => run(subscribeToPush), [run]),
    unsubscribe: useCallback(() => run(unsubscribeFromPush), [run]),
    refresh,
  };
}
