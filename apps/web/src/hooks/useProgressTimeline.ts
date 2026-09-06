import { useCallback, useEffect, useState } from 'react';

import type { Domain, TimelineEvent } from '../types';
import { getProgressTimeline } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseProgressTimelineResult {
  items: TimelineEvent[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

/** How far back the full timeline reads. Under the API's 186-day cap. */
const TIMELINE_DAYS = 180;
const PAGE_SIZE = 50;

/**
 * The evidence timeline, one page at a time (issue #117, epic E11).
 *
 * The cursor is OPAQUE and is passed back verbatim. Reconstructing it from the
 * last item's timestamp would be a second, wrong implementation of the server's
 * ordering — and the one place that shows up is a duplicated or skipped row
 * halfway down somebody's history.
 */
export function useProgressTimeline(domain?: Domain): UseProgressTimelineResult {
  const [items, setItems] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const from = useCallback(
    () => new Date(Date.now() - TIMELINE_DAYS * 86_400_000).toISOString(),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const page = await getProgressTimeline({
          from: from(),
          domain,
          limit: PAGE_SIZE,
        });
        if (!cancelled && isMounted()) {
          setItems(page.items);
          setCursor(page.nextCursor);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load evidence';
        if (!cancelled && isMounted()) setError(message);
      } finally {
        if (!cancelled && isMounted()) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [domain, from, isMounted]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;

    setIsLoadingMore(true);
    try {
      const page = await getProgressTimeline({
        from: from(),
        domain,
        limit: PAGE_SIZE,
        cursor,
      });
      if (isMounted()) {
        // Appended, never merged by id: the server promises a total order with
        // no duplicates across pages, and de-duplicating here would hide the
        // day that stopped being true.
        setItems((current) => [...current, ...page.items]);
        setCursor(page.nextCursor);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load more';
      if (isMounted()) setError(message);
    } finally {
      if (isMounted()) setIsLoadingMore(false);
    }
  }, [cursor, domain, from, isMounted]);

  return {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasMore: cursor !== null,
    loadMore,
  };
}
