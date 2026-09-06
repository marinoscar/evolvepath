import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from '../mocks/server';
import { setMilestones } from '../mocks/progressHandlers';
import { useMilestoneToasts } from '../../hooks/useMilestoneToasts';
import type { Milestone } from '../../types';

// =============================================================================
// One celebration at a time (issue #117, epic E11)
// =============================================================================
//
// PRD §77: "avoid constant confetti". A user who earns three milestones in one
// sweep gets three sentences in a row, not three overlapping toasts.
// =============================================================================

function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm-1',
    kind: 'FIRST_COMEBACK',
    sequence: 1,
    domain: null,
    achievedAt: '2026-03-05T18:00:00.000Z',
    acknowledgedAt: null,
    title: 'First comeback',
    body: 'You returned.',
    meta: {},
    ...over,
  };
}

describe('useMilestoneToasts (#117)', () => {
  it('offers one milestone at a time, in order', async () => {
    setMilestones([
      milestone({ id: 'm-1', title: 'First comeback' }),
      milestone({ id: 'm-2', kind: 'TEN_WORKOUTS', title: '10 workouts completed' }),
    ]);

    const { result } = renderHook(() => useMilestoneToasts());

    await waitFor(() => expect(result.current.current?.id).toBe('m-1'));

    await act(async () => {
      await result.current.dismiss();
    });

    expect(result.current.current?.id).toBe('m-2');
  });

  it('acknowledges on close, so it does not come back on the next device', async () => {
    setMilestones([milestone()]);

    const { result } = renderHook(() => useMilestoneToasts());
    await waitFor(() => expect(result.current.current).not.toBeNull());

    await act(async () => {
      await result.current.dismiss();
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.current).toBeNull();
  });

  it('is null when there is nothing to celebrate', async () => {
    setMilestones([]);

    const { result } = renderHook(() => useMilestoneToasts());

    await waitFor(() => expect(result.current.current).toBeNull());
  });

  it('is silent when the poll fails — the screen behind it is the point', async () => {
    server.use(
      http.get('*/api/progress/milestones', () => new HttpResponse(null, { status: 500 })),
    );

    const { result } = renderHook(() => useMilestoneToasts());

    await waitFor(() => expect(result.current.current).toBeNull());
  });
});
