import { useCallback, useEffect, useState } from 'react';

import type { ComebackCompletion, ComebackStatus, Domain } from '../types';
import {
  chooseComebackDomain,
  completeComeback,
  dismissComeback,
  getComeback,
  startComeback,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseComebackResult {
  status: ComebackStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  choose: (domain: Domain) => Promise<void>;
  start: () => Promise<void>;
  complete: (notes?: string) => Promise<ComebackCompletion | null>;
  dismiss: () => Promise<void>;
}

/**
 * The comeback loop, from the client (issue #119, epic E11).
 *
 * MUTATIONS REPLACE THE STATUS FROM THE SERVER'S ANSWER rather than patching a
 * local copy: `choose` cancels one commitment and creates another, and
 * reproducing that here would be a second, wrong implementation of a rule the
 * API already applied.
 *
 * `complete` is the exception that returns its payload — the done screen needs
 * the celebration, the milestone and the next commitment in one answer, and a
 * second request would put the milestone on the following page load.
 */
export function useComeback(): UseComebackResult {
  const [status, setStatus] = useState<ComebackStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const result = await getComeback();
      if (isMounted()) setStatus(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      if (isMounted()) setError(message);
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<ComebackStatus>) => {
      setError(null);
      try {
        const result = await action();
        if (isMounted()) setStatus(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        // The step is KEPT. A failed request is a reason to try again, not a
        // reason to send somebody who is already struggling back to the start.
        if (isMounted()) setError(message);
      }
    },
    [isMounted],
  );

  const choose = useCallback(
    async (domain: Domain) => run(() => chooseComebackDomain(domain)),
    [run],
  );

  const start = useCallback(async () => run(() => startComeback()), [run]);

  const complete = useCallback(
    async (notes?: string): Promise<ComebackCompletion | null> => {
      setError(null);
      try {
        return await completeComeback(notes);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        if (isMounted()) setError(message);
        return null;
      }
    },
    [isMounted],
  );

  const dismiss = useCallback(async () => {
    setError(null);
    try {
      await dismissComeback();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      if (isMounted()) setError(message);
    }
  }, [isMounted, refresh]);

  return { status, isLoading, error, refresh, choose, start, complete, dismiss };
}
