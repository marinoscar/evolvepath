/**
 * `useAiSettings` (issue #27, epic #20).
 *
 * Against MSW rather than a mocked API module: the behaviours worth asserting
 * here are all about how the hook reacts to REAL response shapes — a 409 on
 * save, a 200 carrying `success: false`, a 429 on refresh — and a mocked
 * client would let the test author invent those shapes rather than exercise
 * them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from '../mocks/server';
import {
  resetAiSettingsState,
  setAiPlatformKeyConfigured,
  setAiSettingsState,
} from '../mocks/handlers';
import { useAiSettings } from '../../hooks/useAiSettings';

describe('useAiSettings', () => {
  beforeEach(() => {
    server.resetHandlers();
    resetAiSettingsState();
  });

  it('loads settings, personas and the catalog', async () => {
    setAiPlatformKeyConfigured(true);

    const { result } = renderHook(() => useAiSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.personas.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.models.models.length).toBeGreaterThan(0));

    expect(result.current.settings?.provider).toBeNull();
    expect(result.current.models.models.map((m) => m.id)).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
    expect(result.current.loadError).toBeNull();
  });

  it('renders a catalog failure inline rather than as a load error', async () => {
    // No platform key: the endpoint answers 200 with success: false. That is an
    // answer, not a broken page.
    const { result } = renderHook(() => useAiSettings());

    await waitFor(() => expect(result.current.models.error).not.toBeNull());

    expect(result.current.models.success).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('saves and adopts the server response as the new baseline', async () => {
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let saved = false;
    await act(async () => {
      saved = await result.current.save({
        provider: 'openai',
        enabled: true,
        defaultModel: null,
        personaModels: {},
        platformApiKey: 'sk-platform-0000000000',
      });
    });

    expect(saved).toBe(true);
    // The version comes back from the server, so the NEXT save's If-Match is
    // right without a reload in between.
    expect(result.current.settings?.version).toBe(1);
    expect(result.current.settings?.platformKeyStatus.configured).toBe(true);
    expect(result.current.saveError).toBeNull();
  });

  it('reloads the form and explains itself on a 409', async () => {
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Somebody else saved in between: the stored version has moved on.
    setAiSettingsState({ version: 7, provider: 'openai', enabled: true });

    let saved = true;
    await act(async () => {
      saved = await result.current.save({
        provider: 'openai',
        enabled: true,
        defaultModel: null,
        personaModels: {},
      });
    });

    expect(saved).toBe(false);
    expect(result.current.saveError).toMatch(/Someone else changed/);
    // Reloaded, so a second Save is not another guaranteed 409.
    expect(result.current.settings?.version).toBe(7);
  });

  it('surfaces a 400 from the model floor as a save error', async () => {
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.save({
        provider: 'openai',
        enabled: true,
        defaultModel: 'gpt-5.3',
        personaModels: {},
      });
    });

    expect(result.current.saveError).toContain('gpt-5.3');
  });

  it('stores a failed test as state rather than throwing', async () => {
    server.use(
      http.post('*/api/ai-settings/test', () =>
        HttpResponse.json({
          data: {
            success: false,
            providerKind: 'openai',
            model: null,
            latencyMs: 12,
            error: 'Incorrect API key provided: sk-***',
            attemptedAt: new Date().toISOString(),
            checks: { listModels: 'failed', generate: 'skipped' },
          },
        }),
      ),
    );

    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.test();
    });

    expect(result.current.testResult?.success).toBe(false);
    expect(result.current.testResult?.error).toBe('Incorrect API key provided: sk-***');
  });

  it('turns a 429 on the test into a test result, not an exception', async () => {
    server.use(
      http.post('*/api/ai-settings/test', () =>
        HttpResponse.json(
          { message: 'Too many test attempts. Try again in 30 s.' },
          { status: 429 },
        ),
      ),
    );

    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.test();
    });

    expect(result.current.testResult?.success).toBe(false);
    expect(result.current.testResult?.error).toMatch(/Too many test attempts/);
  });

  it('turns a 429 on refresh into models.error, not an exception', async () => {
    server.use(
      http.get('*/api/ai-settings/models', () =>
        HttpResponse.json(
          { message: 'Too many test attempts. Try again in 5 s.' },
          { status: 429 },
        ),
      ),
    );

    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refreshModels();
    });

    expect(result.current.models.error).toMatch(/Too many test attempts/);
  });

  it('reports a 403 on load in words the admin can act on', async () => {
    server.use(
      http.get('*/api/ai-settings', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
      ),
    );

    const { result } = renderHook(() => useAiSettings());

    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.loadError).toMatch(/do not have permission/);
  });
});
