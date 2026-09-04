/**
 * `useMyAiKey` (issue #28, epic #20).
 *
 * Against MSW, with a REAL `AuthContext` value whose `refreshUser` is a spy:
 * the single most important behaviour here is that a save and a remove refresh
 * the auth user, because `RequireAiKey` (#29) gates the whole shell on
 * `user.aiKey.configured` and without the refresh the gate would bounce a user
 * straight back to setup after they had just supplied a working key.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from '../mocks/server';
import { resetAiKeyState, setAiKeyConfigured } from '../mocks/handlers';
import { AuthContext } from '../../contexts/AuthContext';
import { useMyAiKey } from '../../hooks/useMyAiKey';

const refreshUser = vi.fn().mockResolvedValue(undefined);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={
        {
          user: null,
          isLoading: false,
          isAuthenticated: true,
          providers: [],
          login: vi.fn(),
          logout: vi.fn(),
          refreshUser,
        } as never
      }
    >
      {children}
    </AuthContext.Provider>
  );
}

describe('useMyAiKey', () => {
  beforeEach(() => {
    server.resetHandlers();
    resetAiKeyState();
    refreshUser.mockClear();
  });

  it('loads the status', async () => {
    const { result } = renderHook(() => useMyAiKey(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.status?.configured).toBe(true);
    expect(result.current.status?.platform.hasDefaultModel).toBe(true);
  });

  it('saves and refreshes the auth user so the gate re-evaluates', async () => {
    setAiKeyConfigured(false);
    const { result } = renderHook(() => useMyAiKey(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let saved = false;
    await act(async () => {
      saved = await result.current.save('sk-a-good-key-00000000');
    });

    expect(saved).toBe(true);
    expect(result.current.status?.configured).toBe(true);
    expect(refreshUser).toHaveBeenCalled();
  });

  it('surfaces the API message on a rejected key', async () => {
    // "That key looks too short" is actionable; "failed to save" is not.
    const { result } = renderHook(() => useMyAiKey(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let saved = true;
    await act(async () => {
      saved = await result.current.save('too-short');
    });

    expect(saved).toBe(false);
    expect(result.current.saveError).toMatch(/too short/);
    expect(refreshUser).not.toHaveBeenCalled();
  });

  it('removes and refreshes the auth user', async () => {
    const { result } = renderHook(() => useMyAiKey(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let removed = false;
    await act(async () => {
      removed = await result.current.remove();
    });

    expect(removed).toBe(true);
    expect(result.current.status?.configured).toBe(false);
    expect(refreshUser).toHaveBeenCalled();
  });

  it('stores a failed test as state rather than throwing', async () => {
    server.use(
      http.post('*/api/me/ai-key/test', () =>
        HttpResponse.json({
          data: {
            success: false,
            providerKind: 'openai',
            model: null,
            latencyMs: 20,
            error: 'Incorrect API key provided: sk-***',
            attemptedAt: new Date().toISOString(),
            checks: { listModels: 'failed', generate: 'skipped' },
          },
        }),
      ),
    );

    const { result } = renderHook(() => useMyAiKey(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.test();
    });

    expect(result.current.testResult?.success).toBe(false);
    expect(result.current.testResult?.error).toBe('Incorrect API key provided: sk-***');
  });

  it('turns a 429 into a test result, not an exception', async () => {
    server.use(
      http.post('*/api/me/ai-key/test', () =>
        HttpResponse.json(
          { message: 'Too many test attempts. Try again in 30 s.' },
          { status: 429 },
        ),
      ),
    );

    const { result } = renderHook(() => useMyAiKey(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.test();
    });

    expect(result.current.testResult?.success).toBe(false);
    expect(result.current.testResult?.error).toMatch(/Too many test attempts/);
  });

  it('drops a stale test result when the key is replaced', async () => {
    // The previous result described a different key.
    const { result } = renderHook(() => useMyAiKey(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.test();
    });
    expect(result.current.testResult).not.toBeNull();

    await act(async () => {
      await result.current.save('sk-a-replacement-key-000');
    });

    expect(result.current.testResult).toBeNull();
  });
});
