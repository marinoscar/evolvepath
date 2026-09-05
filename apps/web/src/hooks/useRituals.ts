import { useCallback, useEffect, useState } from 'react';

import type { MaterializeResult, Ritual, RitualInput } from '../types';
import { ApiError } from '../services/api';
import {
  createRitual,
  deleteRitual,
  getRituals,
  materializeRitual,
  updateRitual,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

/**
 * A 400 the editor can show under the title field.
 *
 * The server refuses a person-targeting title with
 * `details.reason = 'BEHAVIOUR_TARGETS_OTHER_PERSON'` and the offending
 * substring. Surfacing it as a FIELD error rather than a toast is what makes
 * the refusal feel like a correction instead of a rejection.
 */
export class RitualTitleError extends Error {
  constructor(
    message: string,
    public readonly match: string | null,
  ) {
    super(message);
    this.name = 'RitualTitleError';
  }
}

function asTitleError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 400) return error;

  const details = error.details as { reason?: string; match?: string } | undefined;
  if (details?.reason !== 'BEHAVIOUR_TARGETS_OTHER_PERSON') return error;

  return new RitualTitleError(error.message, details.match ?? null);
}

interface UseRitualsResult {
  rituals: Ritual[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: RitualInput) => Promise<Ritual>;
  update: (id: string, patch: RitualInput) => Promise<Ritual>;
  remove: (id: string) => Promise<void>;
  materialize: (id: string) => Promise<MaterializeResult>;
}

export function useRituals(): UseRitualsResult {
  const [rituals, setRituals] = useState<Ritual[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getRituals();
      if (isMounted()) setRituals(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load your rituals';
      if (isMounted()) {
        setError(message);
        setRituals([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  const create = useCallback(
    async (input: RitualInput) => {
      setError(null);
      try {
        const created = await createRitual(input);
        await refresh();
        return created;
      } catch (err) {
        const mapped = asTitleError(err);
        // A lint refusal belongs under the field, not in the page-level error:
        // the page is fine, one word in the form is not.
        if (isMounted() && !(mapped instanceof RitualTitleError)) {
          setError(err instanceof Error ? err.message : 'Failed to create the ritual');
        }
        throw mapped;
      }
    },
    [refresh, isMounted],
  );

  const update = useCallback(
    async (id: string, patch: RitualInput) => {
      setError(null);
      try {
        const updated = await updateRitual(id, patch);
        await refresh();
        return updated;
      } catch (err) {
        const mapped = asTitleError(err);
        if (isMounted() && !(mapped instanceof RitualTitleError)) {
          setError(err instanceof Error ? err.message : 'Failed to save the ritual');
        }
        throw mapped;
      }
    },
    [refresh, isMounted],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteRitual(id);
        await refresh();
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'Failed to delete the ritual');
        }
        throw err;
      }
    },
    [refresh, isMounted],
  );

  const materialize = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const result = await materializeRitual(id);
        await refresh();
        return result;
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'Failed to refresh the occurrences');
        }
        throw err;
      }
    },
    [refresh, isMounted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rituals, isLoading, error, refresh, create, update, remove, materialize };
}

