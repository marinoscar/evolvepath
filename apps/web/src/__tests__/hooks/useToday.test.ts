import { describe, it, expect } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from '../mocks/server';
import { makeCard, seedCommitments, seedTodayState } from '../mocks/todayHandlers';
import { useToday } from '../../hooks/useToday';

describe('useToday', () => {
  it('loads the board', async () => {
    seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));

    const { result } = renderHook(() => useToday());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.today?.domains).toHaveLength(3);
    expect(result.current.today?.nextBestAction?.commitmentId).toBe('work-1');
    expect(result.current.error).toBeNull();
  });

  it('surfaces a failure without leaving a half-rendered board', async () => {
    server.use(
      http.get('*/api/today', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    );

    const { result } = renderHook(() => useToday());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.today).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('refetches when the window regains focus', async () => {
    seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));

    const { result } = renderHook(() => useToday());
    await waitFor(() => expect(result.current.today).not.toBeNull());

    // Something happened elsewhere while the tab was in the background.
    seedCommitments(
      makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }),
      makeCard({ id: 'family-1', domain: 'FAMILY', title: 'Dinner' }),
    );

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() =>
      expect(
        result.current.today?.domains.find((d) => d.domain === 'FAMILY')?.commitments,
      ).toHaveLength(1),
    );
  });

  describe('replaceCommitment', () => {
    it('puts the server’s own card where the old one was', async () => {
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));

      const { result } = renderHook(() => useToday());
      await waitFor(() => expect(result.current.today).not.toBeNull());

      const updated = makeCard({
        id: 'work-1',
        domain: 'WORK',
        title: 'Draft it',
        status: 'COMPLETED',
      });

      act(() => result.current.replaceCommitment(updated));

      expect(
        result.current.today?.domains.find((d) => d.domain === 'WORK')?.commitments[0].status,
      ).toBe('COMPLETED');
    });

    // A reschedule returns a NEW commitment that may belong to a different day;
    // appending it would put tomorrow's row on today's board.
    it('ignores a card that is not on the board rather than appending it', async () => {
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));

      const { result } = renderHook(() => useToday());
      await waitFor(() => expect(result.current.today).not.toBeNull());

      act(() =>
        result.current.replaceCommitment(
          makeCard({ id: 'tomorrow-1', domain: 'WORK', title: 'Draft it' }),
        ),
      );

      expect(
        result.current.today?.domains.find((d) => d.domain === 'WORK')?.commitments,
      ).toHaveLength(1);
    });
  });

  it('reflects the stored check-in in the board it returns', async () => {
    seedCommitments(makeCard({ id: 'work-1', domain: 'WORK' }));
    seedTodayState({
      checkIn: { dateLocal: '2026-03-02', feel: 'LOW_ENERGY', updatedAt: '2026-03-02T08:00:00Z' },
    });

    const { result } = renderHook(() => useToday());

    await waitFor(() => expect(result.current.today).not.toBeNull());
    expect(result.current.today?.checkIn).toEqual({ feel: 'LOW_ENERGY' });
    expect(result.current.today?.nextBestAction?.version).toBe('minimum');
  });
});
