import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { getTodayState, makeCard, seedCommitments } from '../mocks/todayHandlers';
import { useCommitmentActions } from '../../hooks/useCommitmentActions';

describe('useCommitmentActions', () => {
  // Reproducing what "complete" implies — folding the timer, setting
  // versionUsed, recomputing availableActions — would be a second, wrong
  // implementation of the server's rules.
  it('hands the caller the server’s own card rather than a predicted one', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK' }));
    const onCard = vi.fn();

    const { result } = renderHook(() => useCommitmentActions({ onCard }));

    const card = await result.current.complete('c1', { minutesSpent: 30 });

    expect(card.status).toBe('COMPLETED');
    expect(card.minutesSpent).toBe(30);
    expect(card.versionUsed).toBe('FULL');
    // `availableActions` came from the server, so a finished row offers nothing.
    expect(card.availableActions).toEqual([]);
    expect(onCard).toHaveBeenCalledWith(card);
  });

  it('re-reads the board after every successful action', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK' }));
    const onChanged = vi.fn();

    const { result } = renderHook(() => useCommitmentActions({ onChanged }));

    await result.current.skip('c1', { reason: 'AVOIDED' });

    expect(onChanged).toHaveBeenCalled();
    expect(getTodayState().commitments[0].status).toBe('SKIPPED');
  });

  describe('when the server refuses', () => {
    it('surfaces the server’s own message', async () => {
      seedCommitments(
        makeCard({
          id: 'c1',
          domain: 'WORK',
          status: 'STARTED',
          startedAt: '2026-03-02T09:00:00.000Z',
          timer: {
            activeSince: '2026-03-02T09:00:00.000Z',
            activeSeconds: 0,
            elapsedSeconds: 0,
            timerMinutes: 25,
            remainingSeconds: 1500,
          },
        }),
      );

      const { result } = renderHook(() => useCommitmentActions());

      await expect(
        result.current.reschedule('c1', { scheduledStart: '2026-03-03T09:00:00.000Z' }),
      ).rejects.toThrow();

      await waitFor(() =>
        expect(result.current.error).toMatch(/started commitment cannot be rescheduled/i),
      );
    });

    // Whatever the server thinks now is the truth.
    it('re-reads the board so the screen ends up honest', async () => {
      seedCommitments(makeCard({ id: 'c1', domain: 'WORK', status: 'COMPLETED' }));
      const onChanged = vi.fn();

      const { result } = renderHook(() => useCommitmentActions({ onChanged }));

      await expect(result.current.start('c1')).rejects.toThrow();
      expect(onChanged).toHaveBeenCalled();
    });

    it('does not splice a card for an action that failed', async () => {
      seedCommitments(makeCard({ id: 'c1', domain: 'WORK', status: 'COMPLETED' }));
      const onCard = vi.fn();

      const { result } = renderHook(() => useCommitmentActions({ onCard }));

      await expect(result.current.start('c1')).rejects.toThrow();
      expect(onCard).not.toHaveBeenCalled();
    });

    it('clears the message on request', async () => {
      seedCommitments(makeCard({ id: 'c1', domain: 'WORK', status: 'COMPLETED' }));

      const { result } = renderHook(() => useCommitmentActions());
      await expect(result.current.start('c1')).rejects.toThrow();
      await waitFor(() => expect(result.current.error).toBeTruthy());

      result.current.clearError();
      await waitFor(() => expect(result.current.error).toBeNull());
    });
  });

  // A reschedule returns a DIFFERENT commitment; splicing it over the old id
  // would put tomorrow's row where today's used to be.
  it('does not splice the replacement a reschedule returns', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK' }));
    const onCard = vi.fn();

    const { result } = renderHook(() => useCommitmentActions({ onCard }));

    const replacement = await result.current.reschedule('c1', {
      scheduledStart: '2026-03-03T09:00:00.000Z',
    });

    expect(replacement.id).not.toBe('c1');
    expect(replacement.rescheduleCount).toBe(1);
    expect(onCard).not.toHaveBeenCalled();
    expect(getTodayState().commitments[0].status).toBe('RESCHEDULED');
  });

  // The Start screen's "Continue another 15?" fires on a session that has passed
  // its target but never paused.
  it('extends a still-running session without losing the accumulated time', async () => {
    const activeSince = '2026-03-02T09:00:00.000Z';
    seedCommitments(
      makeCard({
        id: 'c1',
        domain: 'WORK',
        status: 'STARTED',
        startedAt: activeSince,
        timer: {
          activeSince,
          activeSeconds: 0,
          elapsedSeconds: 300,
          timerMinutes: 5,
          remainingSeconds: 0,
        },
      }),
    );

    const { result } = renderHook(() => useCommitmentActions());

    const card = await result.current.resume('c1', 15);

    expect(card.timer?.timerMinutes).toBe(20);
    expect(card.timer?.activeSince).toBe(activeSince);
  });

  it('never writes anything when only asking for a proposal', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK' }));

    const { result } = renderHook(() => useCommitmentActions());

    const proposal = await result.current.decompose('c1');

    expect(proposal.source).toBe('ai');
    expect(getTodayState().commitments).toHaveLength(1);
    expect(getTodayState().commitments[0].status).toBe('PLANNED');
  });
});
