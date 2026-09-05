import { useCallback, useEffect, useRef, useState } from 'react';

import type { CommitmentCard, CompleteCommitmentInput, StartContext } from '../types';
import {
  completeCommitment,
  continueCommitment,
  getCommitmentCard,
  partialCommitment,
  pauseCommitment,
  startCommitment,
} from '../services/api';
import { ApiError } from '../services/api';
import { isRunning, remainingSeconds } from '../utils/commitmentTimer';
import { useIsMounted } from './useIsMounted';

interface UseStartSessionResult {
  commitment: StartContext | null;
  isLoading: boolean;
  notFound: boolean;
  error: string | null;
  /** Ticks every second while running; the ANCHOR is the server's activeSince. */
  remaining: number | null;
  running: boolean;
  pending: boolean;
  begin: (minutes: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: (extraMinutes?: number) => Promise<void>;
  finish: (
    which: 'complete' | 'partial',
    body: CompleteCommitmentInput,
  ) => Promise<CommitmentCard | null>;
  clearError: () => void;
}

/**
 * The Start screen's session (epic E05, issue #48).
 *
 * THE COUNTDOWN IS DERIVED, NOT COUNTED. The interval below moves a local `now`
 * forward; every displayed number is recomputed from the server's `activeSince`
 * against it. A counter that decremented its own number would drift, would reset
 * on reload, and would keep counting through a phone's sleep — three different
 * ways to record a duration that never happened.
 *
 * That is also why the hook REFETCHES ON FOCUS: coming back to a backgrounded
 * tab re-anchors on the server's truth rather than trusting whatever the
 * interval did while the browser was throttling it.
 */
export function useStartSession(commitmentId: string | undefined): UseStartSessionResult {
  const [commitment, setCommitment] = useState<StartContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    if (!commitmentId) return;

    try {
      const result = await getCommitmentCard(commitmentId);
      if (!isMounted()) return;
      setCommitment(result);
      setNotFound(false);
    } catch (err) {
      if (!isMounted()) return;
      // 404 is the answer for a foreign id as well as a deleted one, and the
      // screen shows the same thing for both — the API does not distinguish
      // them on purpose.
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof Error ? err.message : 'Could not load this commitment');
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [commitmentId, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const running = isRunning(commitment?.timer ?? null);

  // Only while running: an interval on a paused screen would re-render every
  // second to display a number that cannot change.
  useEffect(() => {
    if (!running) return;

    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  /**
   * Keep the screen awake while the timer runs.
   *
   * Feature-detected and silent on failure: no browser owes us this, and a
   * permission error is not something to put in front of someone who is trying
   * to concentrate.
   */
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    if (!running) return;

    let cancelled = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };

    void nav.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        if (cancelled) void sentinel.release().catch(() => undefined);
        else wakeLock.current = sentinel;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
    };
  }, [running]);

  const act = useCallback(
    async <T>(call: () => Promise<T>): Promise<T | null> => {
      setPending(true);
      setError(null);
      try {
        const result = await call();
        if (isMounted()) setNow(new Date());
        return result;
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'That did not go through');
        }
        // Whatever the server thinks now is the truth.
        await refresh();
        return null;
      } finally {
        if (isMounted()) setPending(false);
      }
    },
    [isMounted, refresh],
  );

  const applyCard = useCallback((card: CommitmentCard) => {
    // The action's own answer, keeping the `whyItMatters` the card read carries
    // and the action responses do not.
    setCommitment((current) => (current ? { ...current, ...card } : current));
  }, []);

  return {
    commitment,
    isLoading,
    notFound,
    error,
    remaining: remainingSeconds(commitment?.timer ?? null, now),
    running,
    pending,

    begin: async (minutes) => {
      if (!commitmentId) return;
      const card = await act(() => startCommitment(commitmentId, { minutes }));
      if (card) applyCard(card);
    },

    pause: async () => {
      if (!commitmentId) return;
      const card = await act(() => pauseCommitment(commitmentId));
      if (card) applyCard(card);
    },

    resume: async (extraMinutes) => {
      if (!commitmentId) return;
      const card = await act(() => continueCommitment(commitmentId, { extraMinutes }));
      if (card) applyCard(card);
    },

    finish: async (which, body) => {
      if (!commitmentId) return null;
      const card = await act(() =>
        which === 'complete'
          ? completeCommitment(commitmentId, body)
          : partialCommitment(commitmentId, body),
      );
      if (card) applyCard(card);
      return card;
    },

    clearError: () => setError(null),
  };
}
