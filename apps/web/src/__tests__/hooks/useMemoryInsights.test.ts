import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { useMemoryInsights } from '../../hooks/useMemoryInsights';
import { makeInsight, memoryState, seedInsights, setNextPropose } from '../mocks/memoryHandlers';
import { server } from '../mocks/server';

describe('useMemoryInsights', () => {
  it('asks for excluded insights too', async () => {
    let asked: string | null = null;
    server.use(
      http.get('*/api/memory-insights', ({ request }) => {
        asked = new URL(request.url).searchParams.get('includeDoNotUse');
        return HttpResponse.json({ items: [] });
      }),
    );

    const { result } = renderHook(() => useMemoryInsights());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // This page is the one place an excluded insight must stay visible:
    // "don't use this for coaching" hides it from the coach, not from the
    // person it is about.
    expect(asked).toBe('true');
  });

  it('loads what is remembered', async () => {
    seedInsights([makeInsight({ id: 'a', statement: 'Mornings work.' })]);

    const { result } = renderHook(() => useMemoryInsights());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.insights).toHaveLength(1);
    expect(result.current.insights[0].statement).toBe('Mornings work.');
  });

  it('refetches after every mutation rather than splicing', async () => {
    seedInsights([makeInsight({ id: 'a', userConfirmed: false })]);

    const { result } = renderHook(() => useMemoryInsights());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.confirm('a');
    });

    // The API orders by category, then confirmed, then confidence — and a
    // confirm moves the row within that order. Reproducing it here would be a
    // second, wrong copy.
    expect(result.current.insights[0].userConfirmed).toBe(true);
    expect(memoryState().insights[0].userConfirmed).toBe(true);
  });

  it('surfaces a failure and rethrows so the caller can react', async () => {
    seedInsights([makeInsight({ id: 'a' })]);
    const { result } = renderHook(() => useMemoryInsights());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    server.use(
      http.post('*/api/memory-insights/:id/confirm', () =>
        HttpResponse.json({ message: 'nope' }, { status: 500 }),
      ),
    );

    let thrown: unknown;
    await act(async () => {
      // Caught inside the act so the state update that follows it is flushed:
      // an act() that rejects never gets to commit what the catch block set.
      await result.current.confirm('a').catch((err) => {
        thrown = err;
      });
    });

    expect(thrown).toBeDefined();
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it('reports why the proposer skipped, without treating it as an error', async () => {
    setNextPropose({ created: [], skipped: 'insufficient_data' });

    const { result } = renderHook(() => useMemoryInsights());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.propose();
    });

    expect(outcome).toEqual({ created: [], skipped: 'insufficient_data' });
    expect(result.current.error).toBeNull();
  });

  it('clears the proposing flag even when the run is refused', async () => {
    setNextPropose('throttled');

    const { result } = renderHook(() => useMemoryInsights());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let thrown: unknown;
    await act(async () => {
      await result.current.propose().catch((err) => {
        thrown = err;
      });
    });

    expect(thrown).toBeDefined();
    // A stuck spinner after a 429 would leave the button disabled forever.
    await waitFor(() => expect(result.current.proposing).toBe(false));
  });
});
