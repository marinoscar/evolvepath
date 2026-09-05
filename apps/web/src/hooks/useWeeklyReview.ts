import { useCallback, useEffect, useState } from 'react';

import type { PlanChange, WeeklyReviewDetail } from '../types';
import {
  generateWeeklyReview,
  getCurrentWeeklyReview,
  listWeeklyReviews,
  getWeeklyReview,
  skipWeeklyReview,
} from '../services/api';
import { useIsMounted } from './useIsMounted';
import { useProposals, type ProposalOutcome } from './useProposals';

/** How often a GENERATING review is re-read while it is being prepared. */
const POLL_MS = 5_000;

interface UseWeeklyReviewResult {
  review: WeeklyReviewDetail | null;
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;
  /** Proposals decided in this session, keyed by id — from `useProposals`. */
  outcomes: Record<string, ProposalOutcome>;
  pendingProposalId: string | null;
  refresh: () => Promise<void>;
  generate: () => Promise<void>;
  skip: () => Promise<void>;
  accept: (proposalId: string) => Promise<void>;
  edit: (proposalId: string, changes: PlanChange[]) => Promise<void>;
  reject: (proposalId: string) => Promise<void>;
}

/**
 * The week on the review screen (issue #84, epic E10).
 *
 * READ-MOSTLY. Every mutation goes through the API and then reloads, so the
 * screen never shows state the server has not persisted (VISION §20) — the one
 * exception is a proposal decision, which `useProposals` holds in memory
 * because the decision is not part of the review row it came from.
 *
 * `weekStart` comes from the URL, so a `?weekStart=` deep link — the one every
 * "your week is ready" notification carries — lands on the right week.
 */
export function useWeeklyReview(weekStart?: string): UseWeeklyReviewResult {
  const [review, setReview] = useState<WeeklyReviewDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();
  const proposals = useProposals();

  const load = useCallback(async () => {
    setError(null);
    try {
      // Without a `weekStart` the newest review is the answer; with one, the
      // list endpoint is the only way to ask for a specific week, and it may
      // legitimately come back empty (that week was never reviewed).
      const found = weekStart
        ? await listWeeklyReviews({ weekStart }).then((items) =>
            items[0] ? getWeeklyReview(items[0].id) : null,
          )
        : await getCurrentWeeklyReview();

      if (isMounted()) setReview(found);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load your week';
      if (isMounted()) {
        setError(message);
        setReview(null);
      }
    }
  }, [weekStart, isMounted]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await load();
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [load, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A review the cron started is GENERATING when the page opens. Polling ends
  // as soon as the status moves, so the common case costs nothing.
  useEffect(() => {
    if (review?.status !== 'GENERATING') return undefined;

    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [review?.status, load]);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const created = await generateWeeklyReview(weekStart ? { weekStart } : {});
      if (isMounted()) setReview(created);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not prepare your week';
      if (isMounted()) setError(message);
    } finally {
      if (isMounted()) setIsGenerating(false);
    }
  }, [weekStart, isMounted]);

  const skip = useCallback(async () => {
    if (!review) return;
    setError(null);
    try {
      await skipWeeklyReview(review.id);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not skip this week';
      if (isMounted()) setError(message);
    }
  }, [review, refresh, isMounted]);

  /**
   * Accepting a proposal changes the PLAN, not the review, so the review is not
   * reloaded — the chip `useProposals` returns is the whole visible effect and
   * a refetch would only re-render the same row.
   */
  const accept = useCallback(
    async (proposalId: string) => {
      await proposals.accept(proposalId).catch(() => undefined);
    },
    [proposals],
  );

  const edit = useCallback(
    async (proposalId: string, changes: PlanChange[]) => {
      await proposals.edit(proposalId, changes).catch(() => undefined);
    },
    [proposals],
  );

  const reject = useCallback(
    async (proposalId: string) => {
      await proposals.reject(proposalId).catch(() => undefined);
    },
    [proposals],
  );

  return {
    review,
    isLoading,
    isGenerating,
    error: error ?? proposals.error,
    outcomes: proposals.outcomes,
    pendingProposalId: proposals.pendingId,
    refresh,
    generate,
    skip,
    accept,
    edit,
    reject,
  };
}
