import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useOutcomes } from '../../hooks/useOutcomes';
import { getPathState, makeOutcome, seedPathState } from '../mocks/pathHandlers';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

describe('useOutcomes', () => {
  it('loads the caller\'s outcomes', async () => {
    seedPathState({ outcomes: [makeOutcome({ title: 'Ship the thing' })] });

    const { result } = renderHook(() => useOutcomes());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.outcomes).toHaveLength(1);
    expect(result.current.outcomes[0].title).toBe('Ship the thing');
  });

  it('excludes archived outcomes unless asked', async () => {
    seedPathState({
      outcomes: [makeOutcome({ title: 'Live' }), makeOutcome({ title: 'Old', state: 'ARCHIVED' })],
    });

    const { result: without } = renderHook(() => useOutcomes());
    await waitFor(() => expect(without.current.isLoading).toBe(false));
    expect(without.current.outcomes.map((o) => o.title)).toEqual(['Live']);

    const { result: with_ } = renderHook(() => useOutcomes({ includeArchived: true }));
    await waitFor(() => expect(with_.current.isLoading).toBe(false));
    expect(with_.current.outcomes.map((o) => o.title)).toEqual(['Live', 'Old']);
  });

  // The list is refetched rather than spliced: the API orders by domain, then
  // importance, then age, and reproducing that here would be a second — wrong
  // — implementation of it.
  it('refetches after a create so the server ordering is preserved', async () => {
    const { result } = renderHook(() => useOutcomes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.create({ domain: 'WORK', title: 'New outcome' });
    });

    await waitFor(() => expect(result.current.outcomes).toHaveLength(1));
    expect(getPathState().outcomes[0].title).toBe('New outcome');
  });

  it('surfaces an API failure as an error string and an empty list', async () => {
    server.use(
      http.get('*/api/outcomes', () =>
        HttpResponse.json(
          { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something broke' },
          { status: 500 },
        ),
      ),
    );

    const { result } = renderHook(() => useOutcomes());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Something broke');
    expect(result.current.outcomes).toEqual([]);
  });
});
