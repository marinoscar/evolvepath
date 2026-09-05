import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BATCH_THRESHOLD,
  clearOutbox,
  outboxKey,
  useSetLogOutbox,
} from '../../hooks/useSetLogOutbox';
import type { LogSetBody } from '../../types';
import {
  batchedSets,
  loggedSetBodies,
  seedSession,
  setSetPostStatus,
} from '../mocks/workoutHandlers';

// =============================================================================
// PRD §121's promise: the runner works in a basement (issue #109, epic E09)
//
// The property under test is that a completed set SURVIVES — the user did it,
// and an app that forgets it because a request failed is one they stop trusting
// mid-workout. The server's idempotency on `clientId` is what makes the retry
// safe, and the duplicate case below is where that shows.
// =============================================================================

const SESSION = 'session-1';

function body(clientId: string, setNumber = 1): LogSetBody {
  return {
    clientId,
    exerciseId: 'exercise-bench',
    setNumber,
    weightKg: 20,
    reps: 12,
    rpe: null,
    discomfort: 'NONE',
    loggedAt: new Date().toISOString(),
  };
}

describe('useSetLogOutbox', () => {
  beforeEach(() => {
    seedSession();
    localStorage.clear();
  });

  afterEach(() => {
    setSetPostStatus(null);
    localStorage.clear();
  });

  it('queues a set, sends it, and clears the queue', async () => {
    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    await act(async () => {
      await result.current.enqueue(body('c1'));
    });

    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(loggedSetBodies().map((row) => row.clientId)).toEqual(['c1']);
    expect(localStorage.getItem(outboxKey(SESSION))).toBeNull();
  });

  it('keeps the set when the network is down', async () => {
    setSetPostStatus(0);
    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    await act(async () => {
      await result.current.enqueue(body('c1'));
    });

    await waitFor(() => expect(result.current.pending).toEqual(['c1']));
    expect(localStorage.getItem(outboxKey(SESSION))).toContain('c1');
  });

  it('replays through the batch endpoint once the network is back', async () => {
    setSetPostStatus(0);
    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    await act(async () => {
      await result.current.enqueue(body('c1', 1));
      await result.current.enqueue(body('c2', 2));
    });

    await waitFor(() => expect(result.current.pending).toHaveLength(BATCH_THRESHOLD));

    setSetPostStatus(null);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(batchedSets()).toHaveLength(1);
    expect(batchedSets()[0].map((row) => row.clientId)).toEqual(['c1', 'c2']);
  });

  it('treats a duplicate as a success, because the server already has it', async () => {
    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    // The set reached the server; the response did not reach us. The queue
    // still holds it, and replaying must not create a second row.
    await act(async () => {
      await result.current.enqueue(body('c1', 1));
    });

    setSetPostStatus(0);
    await act(async () => {
      await result.current.enqueue(body('c2', 2));
    });
    await waitFor(() => expect(result.current.pending).toEqual(['c2']));

    // Re-queue the already-accepted one alongside it.
    localStorage.setItem(
      outboxKey(SESSION),
      JSON.stringify([
        { clientId: 'c1', body: body('c1', 1), queuedAt: new Date().toISOString() },
        { clientId: 'c2', body: body('c2', 2), queuedAt: new Date().toISOString() },
      ]),
    );
    setSetPostStatus(null);

    await act(async () => {
      await result.current.flush();
    });

    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(loggedSetBodies().filter((row) => row.clientId === 'c1')).toHaveLength(1);
  });

  it('stops retrying a set the server refuses, and says so', async () => {
    setSetPostStatus(400);
    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    await act(async () => {
      await result.current.enqueue(body('c1'));
    });

    await waitFor(() =>
      expect(result.current.rejected).toEqual([{ clientId: 'c1', reason: 'REJECTED' }]),
    );
    // A 4xx retried forever is a badge that never clears.
    expect(result.current.pending).toEqual([]);
  });

  it('lets a refused set be discarded', async () => {
    setSetPostStatus(400);
    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    await act(async () => {
      await result.current.enqueue(body('c1'));
    });
    await waitFor(() => expect(result.current.rejected).toHaveLength(1));

    act(() => result.current.discard('c1'));

    expect(result.current.rejected).toEqual([]);
  });

  it('survives storage that throws, which is what private mode does', async () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    await act(async () => {
      await expect(result.current.enqueue(body('c1'))).resolves.toEqual({
        safetyCopy: null,
      });
    });

    // The set still reached the server; it just had no safety net.
    expect(loggedSetBodies().map((row) => row.clientId)).toEqual(['c1']);

    setItem.mockRestore();
  });

  it('reads an empty queue out of corrupt storage rather than throwing', async () => {
    localStorage.setItem(outboxKey(SESSION), 'not json');

    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    await waitFor(() => expect(result.current.pending).toEqual([]));
  });

  it('returns the safety copy the server answered with', async () => {
    const { result } = renderHook(() => useSetLogOutbox(SESSION));

    let outcome: { safetyCopy: string | null } = { safetyCopy: null };

    await act(async () => {
      outcome = await result.current.enqueue({ ...body('c1'), discomfort: 'SHARP_PAIN' });
    });

    expect(outcome.safetyCopy).toContain('Sharp pain is not something to train through');
  });

  it('clears everything for a session', () => {
    localStorage.setItem(outboxKey(SESSION), JSON.stringify([{ clientId: 'c1' }]));

    clearOutbox(SESSION);

    expect(localStorage.getItem(outboxKey(SESSION))).toBeNull();
  });
});
