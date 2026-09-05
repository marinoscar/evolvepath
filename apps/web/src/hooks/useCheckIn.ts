import { useCallback, useState } from 'react';

import type { CheckInFeel } from '../types';
import { postCheckIn } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseCheckInResult {
  save: (feel: CheckInFeel) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}

/**
 * "How does today feel?" (epic E05, issue #46).
 *
 * Does not hold the current value: `GET /today` already carries it, so a second
 * copy here would be a second source of truth for one chip's selected state.
 * The caller refreshes the board after saving, because the answer changes the
 * recommendation — which is the whole reason the question is asked.
 */
export function useCheckIn(onSaved?: () => void | Promise<void>): UseCheckInResult {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const save = useCallback(
    async (feel: CheckInFeel) => {
      setIsSaving(true);
      setError(null);
      try {
        await postCheckIn(feel);
        if (onSaved) await onSaved();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save your check-in';
        if (isMounted()) setError(message);
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [onSaved, isMounted],
  );

  return { save, isSaving, error };
}
