import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useAccountReset } from '../../hooks/useAccountReset';
import {
  getAccountState,
  seedAccountState,
  MOCK_RESET_PHRASES,
} from '../mocks/accountHandlers';

// =============================================================================
// useAccountReset (epic #220, #224)
// =============================================================================
//
// Driven against the real in-memory store in `mocks/accountHandlers.ts`, which
// enforces the phrase rule exactly as the service does — so "a wrong phrase is
// refused" is proved end to end (hook -> api.ts -> MSW -> error) rather than
// asserted against a mock that would have accepted anything.
//
// The shape under test is `useMyAiKey`'s, not `useOutcomes`': the mutation
// resolves a BOOLEAN and never throws, because a refused reset is an ordinary
// outcome this screen renders, not an exception for a caller to catch.
// =============================================================================

describe('useAccountReset', () => {
  it('loads the summary on mount, with the counts and both phrases', async () => {
    const { result } = renderHook(() => useAccountReset());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.summary?.counts.commitments).toBe(4);
    expect(result.current.summary?.phrases).toEqual(MOCK_RESET_PHRASES);
    expect(result.current.error).toBeNull();
  });

  it('resolves true and clears the data on the correct phrase', async () => {
    const { result } = renderHook(() => useAccountReset());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.reset('data', MOCK_RESET_PHRASES.data);
    });

    expect(ok).toBe(true);
    expect(getAccountState().counts.commitments).toBe(0);
  });

  it('resolves FALSE and never throws on a refused phrase, and the data survives', async () => {
    const { result } = renderHook(() => useAccountReset());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      // No try/catch here on purpose: if the hook throws, this test fails, which
      // is the assertion. A screen should not have to guard an ordinary refusal.
      ok = await result.current.reset('data', 'nope');
    });

    expect(ok).toBe(false);
    expect(getAccountState().counts.commitments).toBe(4);
  });

  it("surfaces the server's own message rather than a generic one", async () => {
    const { result } = renderHook(() => useAccountReset());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reset('data', 'nope');
    });

    await waitFor(() => expect(result.current.error).toMatch(/did not match/i));
  });

  it('removes the AI key only on data_and_key', async () => {
    seedAccountState({ aiKeyConfigured: true });
    const { result } = renderHook(() => useAccountReset());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reset('data', MOCK_RESET_PHRASES.data);
    });
    expect(getAccountState().aiKeyConfigured).toBe(true);

    await act(async () => {
      await result.current.reset(
        'data_and_key',
        MOCK_RESET_PHRASES.data_and_key,
      );
    });
    expect(getAccountState().aiKeyConfigured).toBe(false);
  });

  it('sends the phrase it was given verbatim, whitespace and all', async () => {
    const { result } = renderHook(() => useAccountReset());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reset('data', `  ${MOCK_RESET_PHRASES.data}  `);
    });

    const [sent] = getAccountState().recordedResets;
    expect(sent.confirmationPhrase).toBe(`  ${MOCK_RESET_PHRASES.data}  `);
  });
});
