import { useCallback, useEffect, useRef, useState } from 'react';

import type { FocusSession, FocusSessionOutcome } from '../types';
import { ApiError } from '../services/api';
import {
  addFocusSessionNote,
  extendFocusSession,
  getActiveFocusSession,
  startFocusSession,
  stopFocusSession,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

export interface FocusSessionConflict {
  activeSessionId: string;
  commitmentId: string;
}

interface UseFocusSessionResult {
  session: FocusSession | null;
  /** Set when another commitment's session is running (409). */
  conflict: FocusSessionConflict | null;
  pending: boolean;
  error: string | null;
  /** The server's clock at the last read; the countdown re-anchors on it. */
  serverNow: Date | null;
  begin: (input: {
    commitmentId: string;
    plannedMinutes: number;
    instruction?: string | null;
    takeOver?: boolean;
  }) => Promise<FocusSession | null>;
  extend: (minutes: number) => Promise<void>;
  addNote: (text: string) => Promise<void>;
  stop: (
    outcome: FocusSessionOutcome,
    notes?: string | null,
  ) => Promise<{ actualMinutes: number; continuedCount: number } | null>;
  clearConflict: () => void;
}

/**
 * The server-side focus session behind the Start screen (epic E07, PRD §27–§28).
 *
 * IT RE-ANCHORS FROM `serverNow`, NEVER FROM `Date.now()` DRIFT. The session is
 * read on mount and again on every `visibilitychange` and `focus`, because a
 * phone that slept through half a session comes back with a clock that is right
 * and an interval that is not.
 *
 * The commitment's own timer keeps coming from E05's card; this hook adds only
 * what a commitment has no column for — the notes, the continue count, and the
 * session's identity for `extend` and `stop`.
 */
export function useFocusSession(commitmentId: string | undefined): UseFocusSessionResult {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [conflict, setConflict] = useState<FocusSessionConflict | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const isMounted = useIsMounted();

  // Read in the visibility handler, which must not be re-registered on every
  // render just because the id it compares against is in scope.
  const commitmentIdRef = useRef(commitmentId);
  commitmentIdRef.current = commitmentId;

  const readActive = useCallback(async () => {
    try {
      const active = await getActiveFocusSession();
      if (!isMounted()) return;

      setServerNow(new Date(active.serverNow));

      // Only adopt a session that belongs to THIS commitment. Somebody else's
      // running session is a conflict the Begin button reports, not a session
      // this screen should render a countdown for.
      setSession(
        active.session && active.session.commitmentId === commitmentIdRef.current
          ? active.session
          : null,
      );
    } catch {
      // A failed read leaves whatever the screen already had. The local timer
      // keeps running; the next focus event tries again.
    }
  }, [isMounted]);

  useEffect(() => {
    void readActive();
  }, [readActive]);

  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') void readActive();
    };

    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [readActive]);

  const act = useCallback(
    async <T>(call: () => Promise<T>): Promise<T | null> => {
      setPending(true);
      setError(null);

      try {
        return await call();
      } catch (err) {
        if (!isMounted()) return null;

        // The one error with a decision behind it: another commitment's session
        // is running, and the user chooses whether to take it over.
        if (err instanceof ApiError && err.status === 409) {
          const details = err.details as
            | { reason?: string; activeSessionId?: string; commitmentId?: string }
            | undefined;

          if (details?.reason === 'FOCUS_SESSION_ACTIVE' && details.activeSessionId) {
            setConflict({
              activeSessionId: details.activeSessionId,
              commitmentId: details.commitmentId ?? '',
            });
            return null;
          }
        }

        setError(err instanceof Error ? err.message : 'That did not go through');
        return null;
      } finally {
        if (isMounted()) setPending(false);
      }
    },
    [isMounted],
  );

  return {
    session,
    conflict,
    pending,
    error,
    serverNow,

    begin: async (input) => {
      const started = await act(() => startFocusSession(input));
      if (started && isMounted()) {
        setSession(started);
        setConflict(null);
      }
      return started;
    },

    extend: async (minutes) => {
      if (!session) return;
      const extended = await act(() => extendFocusSession(session.id, minutes));
      if (extended && isMounted()) setSession(extended);
    },

    addNote: async (text) => {
      if (!session || !text.trim()) return;
      const updated = await act(() => addFocusSessionNote(session.id, text.trim()));
      if (updated && isMounted()) setSession(updated);
    },

    stop: async (outcome, notes) => {
      if (!session) return null;
      const stopped = await act(() => stopFocusSession(session.id, outcome, notes));
      if (!stopped) return null;

      if (isMounted()) setSession(stopped.session);

      return {
        actualMinutes: stopped.actualMinutes,
        continuedCount: stopped.session.continuedCount,
      };
    },

    clearConflict: () => setConflict(null),
  };
}
