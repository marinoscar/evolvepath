import { useCallback, useEffect, useState } from 'react';

import type { Outcome, OutcomeInput } from '../types';
import { archiveOutcome, createOutcome, getOutcomes, updateOutcome } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseOutcomesOptions {
  includeArchived?: boolean;
}

interface UseOutcomesResult {
  outcomes: Outcome[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: OutcomeInput) => Promise<Outcome>;
  update: (id: string, patch: OutcomeInput) => Promise<Outcome>;
  archive: (id: string) => Promise<Outcome>;
}

export function useOutcomes(options: UseOutcomesOptions = {}): UseOutcomesResult {
  const { includeArchived = false } = options;
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getOutcomes({ includeArchived });
      if (isMounted()) setOutcomes(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load outcomes';
      if (isMounted()) {
        setError(message);
        setOutcomes([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [includeArchived, isMounted]);

  // Each mutation REFETCHES rather than splicing the response into the list.
  // The API orders by domain, then importance, then age — reproducing that
  // ordering here would be a second implementation of it, and a wrong one the
  // first time the API's ordering changes.
  const create = useCallback(
    async (input: OutcomeInput) => {
      setError(null);
      try {
        const created = await createOutcome(input);
        await refresh();
        return created;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create the outcome';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [refresh, isMounted],
  );

  const update = useCallback(
    async (id: string, patch: OutcomeInput) => {
      setError(null);
      try {
        const updated = await updateOutcome(id, patch);
        await refresh();
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update the outcome';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [refresh, isMounted],
  );

  const archive = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const archived = await archiveOutcome(id);
        await refresh();
        return archived;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to archive the outcome';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [refresh, isMounted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { outcomes, isLoading, error, refresh, create, update, archive };
}
