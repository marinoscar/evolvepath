/**
 * `/admin/settings/ai` — the SAVE REQUEST wire contract (issue #27, epic #20).
 *
 * Deliberately NOT mocking `useAiSettings`: the key-omission behaviour and the
 * persona-map shape live in the page's own `toInput()`, which the hook forwards
 * unchanged. Asserting them therefore means capturing the ACTUAL request body a
 * real save produces — only the network is faked, with MSW.
 *
 * The twin of `EmailSettingsPage.wire.test.tsx`, and for the same reason: blank
 * preserves is a contract about what is ON THE WIRE, and a test that reads form
 * state instead would pass over an implementation that sends `platformApiKey: ''`
 * to a server that might one day read that as "clear it".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import AiSettingsPage from '../../../pages/Admin/AiSettingsPage';
import type { AiSettings } from '../../../types';

const storedSettings: AiSettings = {
  provider: 'openai',
  enabled: true,
  defaultModel: 'gpt-5.4',
  personaModels: {},
  platformKeyStatus: {
    configured: true,
    hint: '••••0000',
    updatedAt: '2026-09-01T00:00:00.000Z',
    updatedByUserId: 'admin-user-id',
  },
  settingsError: null,
  version: 3,
  updatedAt: '2026-09-01T00:00:00.000Z',
  updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
};

function mockReads() {
  server.use(
    http.get('*/api/ai-settings', () => HttpResponse.json({ data: storedSettings })),
    http.get('*/api/ai-settings/personas', () =>
      HttpResponse.json({
        data: [
          {
            key: 'coach',
            label: 'Coach',
            description: 'Day-to-day coaching replies.',
            tier: 'fast',
            capabilities: ['text'],
          },
        ],
      }),
    ),
    http.get('*/api/ai-settings/models', () =>
      HttpResponse.json({
        data: {
          success: true,
          models: [
            { id: 'gpt-5.4', created: 1 },
            { id: 'gpt-5.4-mini', created: 2 },
          ],
          fetchedAt: '2026-09-01T00:00:00.000Z',
          source: 'live',
          error: null,
        },
      }),
    ),
  );
}

function capturePut() {
  const captured: {
    body: Record<string, unknown> | null;
    ifMatch: string | null;
  } = { body: null, ifMatch: null };

  server.use(
    http.put('*/api/ai-settings', async ({ request }) => {
      captured.body = (await request.json()) as Record<string, unknown>;
      captured.ifMatch = request.headers.get('if-match');
      // ECHOES THE SUBMITTED BODY, because the page adopts the response as its
      // new baseline. Returning the ORIGINAL row would silently revert the form
      // after every save, and the multi-step case below would then be driving a
      // control that never moved.
      return HttpResponse.json({
        data: {
          ...storedSettings,
          ...captured.body,
          platformKeyStatus: storedSettings.platformKeyStatus,
          version: storedSettings.version + 1,
        },
      });
    }),
  );

  return captured;
}

function mockViewport() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

async function renderAndWait() {
  render(<AiSettingsPage />, { wrapperOptions: { user: mockAdminUser } });
  await waitFor(() =>
    expect(screen.getByLabelText('Platform API key')).toBeInTheDocument(),
  );
}

describe('AiSettingsPage — save request wire contract', () => {
  beforeEach(() => {
    server.resetHandlers();
    mockViewport();
    mockReads();
  });

  it('omits platformApiKey entirely when the field is left blank', async () => {
    const user = userEvent.setup();
    const captured = capturePut();
    await renderAndWait();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(captured.body).not.toBeNull());
    // ABSENT, not `''`. The intent reaches the API as an absence rather than as
    // a value a future server revision might read as "clear it".
    expect(captured.body).not.toHaveProperty('platformApiKey');
  });

  it('sends the typed key verbatim when one is entered', async () => {
    const user = userEvent.setup();
    const captured = capturePut();
    await renderAndWait();

    await user.type(screen.getByLabelText('Platform API key'), 'sk-typed-key-0000000000');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(captured.body).not.toBeNull());
    expect(captured.body?.platformApiKey).toBe('sk-typed-key-0000000000');
  });

  it('sends the loaded version as If-Match', async () => {
    const user = userEvent.setup();
    const captured = capturePut();
    await renderAndWait();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(captured.ifMatch).not.toBeNull());
    expect(captured.ifMatch).toBe('3');
  });

  it('sends only the personas the admin touched, with null for "use default"', async () => {
    const user = userEvent.setup();
    const captured = capturePut();
    await renderAndWait();

    // Nothing touched yet: the map is empty, not eight explicit nulls. A
    // materialised map would mean adding a persona became a data migration.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(captured.body).not.toBeNull());
    expect(captured.body?.personaModels).toEqual({});

    captured.body = null;

    await user.click(screen.getByLabelText('Model for Coach'));
    await user.click(screen.getByRole('option', { name: 'gpt-5.4-mini' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(captured.body).not.toBeNull());
    expect(captured.body?.personaModels).toEqual({ coach: 'gpt-5.4-mini' });

    captured.body = null;

    await user.click(screen.getByLabelText('Model for Coach'));
    await user.click(screen.getByRole('option', { name: 'Use default (gpt-5.4)' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(captured.body).not.toBeNull());
    // `null`, not an omitted key: the form round-trips "use default" as a value.
    expect(captured.body?.personaModels).toEqual({ coach: null });
  });

  it('sends a cleared base URL as an empty string, not as an omitted key', async () => {
    // `blankable` exists to accept exactly what a cleared control produces and
    // convert it to "absent" once, server-side.
    const user = userEvent.setup();
    const captured = capturePut();
    await renderAndWait();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(captured.body).not.toBeNull());
    expect(captured.body?.baseUrl).toBe('');
  });
});
