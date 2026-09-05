import { useCallback, useEffect, useState } from 'react';

import type { TodayResponse } from '../types';
import { getToday } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseTodayResult {
  today: TodayResponse | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Replace one card in place after an action, without a round trip. */
  replaceCommitment: (card: import('../types').CommitmentCard) => void;
}

/**
 * The Today screen's one read (epic E05, issue #46).
 *
 * REFETCHES ON WINDOW FOCUS. Today is a screen people leave open — on a second
 * monitor, on a phone in a pocket — and come back to hours later, possibly after
 * acting on the same commitment somewhere else. A stale board is worse here than
 * on any other screen, because the whole point of it is "what is next".
 */
export function useToday(): UseTodayResult {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const result = await getToday();
      if (isMounted()) setToday(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load today';
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

  /**
   * Splice one card the server just returned into the board.
   *
   * The exception to "mutations refetch rather than splice": an action endpoint
   * returns the authoritative card for the row it touched, so this is not the
   * client reproducing the API's decision — it is the API's own answer, put
   * where it belongs. `refresh` still runs afterwards for anything the action
   * changed elsewhere (the recommendation, the domain counts).
   *
   * A card whose id is not on the board is ignored rather than appended: a
   * reschedule returns a NEW commitment that may belong to a different day.
   */
  const replaceCommitment = useCallback((card: import('../types').CommitmentCard) => {
    setToday((current) => {
      if (!current) return current;

      let found = false;
      const domains = current.domains.map((section) => ({
        ...section,
        commitments: section.commitments.map((existing) => {
          if (existing.id !== card.id) return existing;
          found = true;
          return card;
        }),
      }));

      return found ? { ...current, domains } : current;
    });
  }, []);

  return { today, isLoading, error, refresh, replaceCommitment };
}
