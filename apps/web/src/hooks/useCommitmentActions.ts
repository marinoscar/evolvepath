import { useCallback, useState } from 'react';

import type {
  CommitmentActionName,
  CommitmentCard,
  CompleteCommitmentInput,
  DecompositionProposal,
  SkipReason,
} from '../types';
import {
  applyDecomposition,
  completeCommitment,
  continueCommitment,
  partialCommitment,
  pauseCommitment,
  proposeDecomposition,
  rescheduleCommitment,
  skipCommitment,
  startCommitment,
  useCommitmentFallback,
} from '../services/api';
import { ApiError } from '../services/api';
import { useIsMounted } from './useIsMounted';

export interface CommitmentActionsResult {
  start: (id: string, minutes?: number | null) => Promise<CommitmentCard>;
  pause: (id: string) => Promise<CommitmentCard>;
  resume: (id: string, extraMinutes?: number | null) => Promise<CommitmentCard>;
  complete: (id: string, body?: CompleteCommitmentInput) => Promise<CommitmentCard>;
  partial: (id: string, body?: CompleteCommitmentInput) => Promise<CommitmentCard>;
  fallback: (id: string, version: 'short' | 'minimum') => Promise<CommitmentCard>;
  reschedule: (
    id: string,
    body: { scheduledStart: string; scheduledEnd?: string | null },
  ) => Promise<CommitmentCard>;
  skip: (
    id: string,
    body: { reason: SkipReason; text?: string | null },
  ) => Promise<CommitmentCard>;
  decompose: (id: string, hint?: string | null) => Promise<DecompositionProposal>;
  applyProposal: (id: string, proposal: DecompositionProposal) => Promise<CommitmentCard>;
  /** The id currently being acted on, so a row can disable its own buttons. */
  pendingId: string | null;
  pendingAction: CommitmentActionName | null;
  error: string | null;
  clearError: () => void;
}

interface Options {
  /** Called with the server's own card for the row that was acted on. */
  onCard?: (card: CommitmentCard) => void;
  /** Called after any successful action, to pick up what changed elsewhere. */
  onChanged?: () => void | Promise<void>;
}

/**
 * The commitment verbs, from any surface (epic E05, issue #46).
 *
 * NO OPTIMISTIC STATUS GUESSING. Every action endpoint returns the
 * authoritative card, and this hook hands that card back through `onCard`
 * rather than predicting what the action implied and reconciling later. The
 * prediction is exactly where a UI drifts from an API: "complete" also folds
 * the timer, sets `versionUsed`, recomputes `availableActions` and may change
 * `minutesSpent` — reproducing that client-side is a second, wrong
 * implementation of the server's rules.
 *
 * What IS optimistic is the button state: `pendingId` disables the row while a
 * request is in flight, so a double tap cannot send two starts.
 */
export function useCommitmentActions(options: Options = {}): CommitmentActionsResult {
  const { onCard, onChanged } = options;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<CommitmentActionName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const run = useCallback(
    async <T>(
      id: string,
      action: CommitmentActionName,
      call: () => Promise<T>,
      applies: boolean,
    ): Promise<T> => {
      setPendingId(id);
      setPendingAction(action);
      setError(null);

      try {
        const result = await call();
        if (applies && onCard) onCard(result as unknown as CommitmentCard);
        if (onChanged) await onChanged();
        return result;
      } catch (err) {
        // A 409 means the world moved under this screen — someone completed
        // the commitment on another device, or the row is already terminal.
        // The server's own message names which, so it is shown verbatim rather
        // than replaced with a guess.
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'That action did not go through';
        if (isMounted()) setError(message);
        // Re-read the board: whatever the server thinks now is the truth.
        if (onChanged) await onChanged();
        throw err;
      } finally {
        if (isMounted()) {
          setPendingId(null);
          setPendingAction(null);
        }
      }
    },
    [onCard, onChanged, isMounted],
  );

  return {
    start: (id, minutes) => run(id, 'start', () => startCommitment(id, { minutes }), true),
    pause: (id) => run(id, 'pause', () => pauseCommitment(id), true),
    resume: (id, extraMinutes) =>
      run(id, 'continue', () => continueCommitment(id, { extraMinutes }), true),
    complete: (id, body = {}) => run(id, 'complete', () => completeCommitment(id, body), true),
    partial: (id, body = {}) => run(id, 'partial', () => partialCommitment(id, body), true),
    fallback: (id, version) =>
      run(id, 'fallback', () => useCommitmentFallback(id, version), true),
    // A reschedule returns a DIFFERENT commitment — the original is closed. It
    // deliberately does not go through `onCard`: splicing the new row over the
    // old id would put tomorrow's commitment on today's board.
    reschedule: (id, body) =>
      run(id, 'reschedule', () => rescheduleCommitment(id, body), false),
    skip: (id, body) => run(id, 'skip', () => skipCommitment(id, body), true),
    decompose: (id, hint) =>
      run(id, 'decompose', () => proposeDecomposition(id, { hint }), false),
    applyProposal: (id, proposal) =>
      run(id, 'decompose', () => applyDecomposition(id, proposal), false),
    pendingId,
    pendingAction,
    error,
    clearError: () => setError(null),
  };
}
