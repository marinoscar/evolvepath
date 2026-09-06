/**
 * The "Danger zone": what a reset would erase, and the call that erases it.
 *
 * Issue #224, epic #220. Shaped like `useMyAiKey` rather than like
 * `useOutcomes`, deliberately: a per-operation busy flag, errors flattened to a
 * `string | null` the page renders, and `reset` resolving a BOOLEAN instead of
 * throwing. `useOutcomes` rethrows because its callers are forms that want the
 * rejection; this hook's one caller is a confirmation dialog that has to stay
 * open, keep the typed phrase, and show the server's message when the reset is
 * refused — a thrown error there is an unmounted dialog and a lost sentence.
 *
 * -----------------------------------------------------------------------------
 * THIS HOOK DOES NOT REFRESH THE AUTH USER, AND DOES NOT NAVIGATE
 * -----------------------------------------------------------------------------
 *
 * `useMyAiKey.remove` calls `refreshUser()` itself, because removing a key
 * invalidates exactly one gate and there is exactly one thing to do about it.
 * A reset invalidates TWO gates and the destination depends on the scope, so
 * that decision belongs to `UserDataResetPage`, which is the thing that knows
 * both. See that page's header for the ordering rule this leaves it to keep.
 */

import { useState, useEffect, useCallback } from 'react';
import { ApiError, getAccountDataSummary, resetAccount } from '../services/api';
import type { AccountDataSummary, AccountResetScope } from '../types';
import { useIsMounted } from './useIsMounted';

interface UseAccountResetReturn {
  summary: AccountDataSummary | null;
  isLoading: boolean;
  error: string | null;
  isResetting: boolean;
  refresh: () => Promise<void>;
  /** Resolves `true` when the reset was performed — never throws. */
  reset: (scope: AccountResetScope, confirmationPhrase: string) => Promise<boolean>;
}

export function useAccountReset(): UseAccountResetReturn {
  const [summary, setSummary] = useState<AccountDataSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const isMounted = useIsMounted();

  const fetchSummary = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getAccountDataSummary();
      if (isMounted()) setSummary(data);
    } catch (err) {
      if (isMounted()) {
        setError(
          err instanceof ApiError ? err.message : 'Failed to load what a reset would erase',
        );
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const reset = useCallback(
    async (scope: AccountResetScope, confirmationPhrase: string): Promise<boolean> => {
      try {
        setIsResetting(true);
        setError(null);
        await resetAccount({ scope, confirmationPhrase });
        return true;
      } catch (err) {
        if (isMounted()) {
          // The API's message verbatim. A mistyped phrase comes back as a
          // readable 400 saying so, and flattening that to "reset failed" would
          // leave the user re-reading a dialog that already told them what to
          // type.
          setError(err instanceof ApiError ? err.message : 'Failed to reset your data');
        }
        return false;
      } finally {
        if (isMounted()) setIsResetting(false);
      }
    },
    [isMounted],
  );

  return {
    summary,
    isLoading,
    error,
    isResetting,
    refresh: fetchSummary,
    reset,
  };
}
