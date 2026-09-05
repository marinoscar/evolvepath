import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useBestSelf } from '../../hooks/useBestSelf';
import { getPathState } from '../mocks/pathHandlers';

describe('useBestSelf', () => {
  // `null` is "never saved", which the card renders as a question rather than
  // as an error.
  it('starts null before the profile has ever been saved', async () => {
    const { result } = renderHook(() => useBestSelf());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('saves and adopts the response without a second request', async () => {
    const { result } = renderHook(() => useBestSelf());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.save({ identityStatement: 'Focused, present, healthy' });
    });

    expect(result.current.profile?.identityStatement).toBe('Focused, present, healthy');
    // Stamped by the server on every replacement — the card renders it.
    expect(result.current.profile?.lastReviewedAt).not.toBeNull();
    expect(getPathState().bestSelf?.identityStatement).toBe('Focused, present, healthy');
  });

  it('clears omitted fields — the API has no PATCH for this', async () => {
    const { result } = renderHook(() => useBestSelf());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.save({
        identityStatement: 'First',
        sixMonthVision: 'A vision',
      });
    });
    await act(async () => {
      await result.current.save({ identityStatement: 'Second' });
    });

    expect(result.current.profile?.identityStatement).toBe('Second');
    expect(result.current.profile?.sixMonthVision).toBeNull();
  });
});
