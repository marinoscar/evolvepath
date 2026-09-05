import { useCallback, useEffect, useState } from 'react';

import type {
  MemoryInsight,
  MemoryInsightCategory,
  ProposeInsightsResult,
} from '../types';
import {
  confirmMemoryInsight,
  createMemoryInsight,
  deleteMemoryInsight,
  getMemoryInsights,
  proposeMemoryInsights,
  setMemoryInsightDoNotUse,
  updateMemoryInsight,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

export interface UseMemoryInsightsResult {
  insights: MemoryInsight[];
  isLoading: boolean;
  error: string | null;
  /** True while a proposer run is outstanding. */
  proposing: boolean;
  refresh: () => Promise<void>;
  create: (input: { category: MemoryInsightCategory; statement: string }) => Promise<void>;
  edit: (id: string, statement: string) => Promise<void>;
  confirm: (id: string) => Promise<void>;
  setDoNotUse: (id: string, doNotUse: boolean) => Promise<void>;
  forget: (id: string) => Promise<void>;
  propose: () => Promise<ProposeInsightsResult>;
}

/**
 * Everything the settings page does to memory.
 *
 * `includeDoNotUse: true`, always. This page is the one place an excluded
 * insight has to remain visible: "don't use this for coaching" hides it from
 * the coach, not from the person it is about (PRD §85).
 */
export function useMemoryInsights(): UseMemoryInsightsResult {
  const [insights, setInsights] = useState<MemoryInsight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getMemoryInsights({ includeDoNotUse: true });
      if (isMounted()) setInsights(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load your insights';
      if (isMounted()) {
        setError(message);
        setInsights([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  // Each mutation REFETCHES rather than splicing: the API orders by category,
  // then confirmed, then confidence, and an edit can move a row between two of
  // those. Reproducing that ordering here would be a second, wrong copy of it.
  const mutate = useCallback(
    async (work: () => Promise<unknown>, failure: string) => {
      setError(null);
      try {
        await work();
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : failure;
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [isMounted, refresh],
  );

  const create = useCallback(
    (input: { category: MemoryInsightCategory; statement: string }) =>
      mutate(() => createMemoryInsight(input), 'Could not add that insight'),
    [mutate],
  );

  const edit = useCallback(
    (id: string, statement: string) =>
      mutate(() => updateMemoryInsight(id, statement), 'Could not save that insight'),
    [mutate],
  );

  const confirm = useCallback(
    (id: string) => mutate(() => confirmMemoryInsight(id), 'Could not confirm that insight'),
    [mutate],
  );

  const setDoNotUse = useCallback(
    (id: string, doNotUse: boolean) =>
      mutate(
        () => setMemoryInsightDoNotUse(id, doNotUse),
        'Could not change how this insight is used',
      ),
    [mutate],
  );

  const forget = useCallback(
    (id: string) => mutate(() => deleteMemoryInsight(id), 'Could not forget that insight'),
    [mutate],
  );

  const propose = useCallback(async () => {
    setProposing(true);
    setError(null);
    try {
      const result = await proposeMemoryInsights();
      await refresh();
      return result;
    } finally {
      if (isMounted()) setProposing(false);
    }
  }, [isMounted, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    insights,
    isLoading,
    error,
    proposing,
    refresh,
    create,
    edit,
    confirm,
    setDoNotUse,
    forget,
    propose,
  };
}
