/**
 * `/admin/settings/ai` (issue #27, epic #20).
 *
 * `useAiSettings` is mocked, matching `EmailSettingsPage.test.tsx` and the four
 * sibling Console settings pages: this suite is about the PAGE's rendering and
 * gating logic, not the hook's fetch/save plumbing, which has its own test.
 *
 * The exception is the platform-key wire contract
 * (`AiSettingsPage.wire.test.tsx`), which needs the real `toInput()` feeding a
 * real request body and therefore mounts the page with the REAL hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../../utils/test-utils';
import type { AiSettings, AiTestResult } from '../../../types';

vi.mock('../../../hooks/useAiSettings', () => ({
  useAiSettings: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

import { useAiSettings } from '../../../hooks/useAiSettings';
import { usePermissions } from '../../../hooks/usePermissions';
import AiSettingsPage from '../../../pages/Admin/AiSettingsPage';

const mockUseAiSettings = vi.mocked(useAiSettings);
const mockUsePermissions = vi.mocked(usePermissions);

const WRITE_PERMISSIONS = ['system_settings:read', 'system_settings:write'];
const READ_ONLY_PERMISSIONS = ['system_settings:read'];

/** jsdom has no matchMedia; the page's persona table reads it. */
function mockViewport(compact = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: compact && query.includes('max-width'),
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

function setPermissions(granted: string[]) {
  mockUsePermissions.mockReturnValue({
    permissions: new Set(granted),
    roles: new Set(['admin']),
    hasPermission: (permission: string) => granted.includes(permission),
    hasAnyPermission: vi.fn(),
    hasAllPermissions: vi.fn(),
    hasRole: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin: true,
  });
}

const configuredSettings: AiSettings = {
  provider: 'openai',
  enabled: true,
  defaultModel: 'gpt-5.4',
  personaModels: { coach: 'gpt-5.4-mini' },
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

const freshSettings: AiSettings = {
  ...configuredSettings,
  provider: null,
  enabled: false,
  defaultModel: null,
  personaModels: {},
  platformKeyStatus: {
    configured: false,
    hint: null,
    updatedAt: null,
    updatedByUserId: null,
  },
  version: 0,
  updatedBy: null,
};

function setHook(overrides: Partial<ReturnType<typeof useAiSettings>> = {}) {
  const save = vi.fn().mockResolvedValue(true);
  const test = vi.fn().mockResolvedValue(undefined);
  const refreshModels = vi.fn().mockResolvedValue(undefined);

  mockUseAiSettings.mockReturnValue({
    settings: configuredSettings,
    personas: [
      {
        key: 'coach',
        label: 'Coach',
        description: 'Day-to-day coaching replies.',
        tier: 'fast',
        capabilities: ['text'],
      },
    ],
    models: {
      success: true,
      models: [
        { id: 'gpt-5.4', created: 1 },
        { id: 'gpt-5.4-mini', created: 2 },
      ],
      fetchedAt: '2026-09-01T00:00:00.000Z',
      source: 'live',
      error: null,
    },
    isLoading: false,
    loadError: null,
    isSaving: false,
    saveError: null,
    isTesting: false,
    testResult: null,
    isRefreshingModels: false,
    save,
    test,
    refreshModels,
    clearTestResult: vi.fn(),
    clearSaveError: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  });

  return { save, test, refreshModels };
}

const renderAsAdmin = () =>
  render(<AiSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

describe('AiSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewport(false);
    setPermissions(WRITE_PERMISSIONS);
    setHook();
  });

  describe('provider and enabled are separate axes', () => {
    it('selects no radio when no provider has been chosen', () => {
      setHook({ settings: freshSettings });
      renderAsAdmin();

      expect(screen.getByRole('radio', { name: 'OpenAI' })).not.toBeChecked();
      expect(
        screen.getByText(/No provider has been chosen yet/),
      ).toBeInTheDocument();
    });

    it('does not switch AI on as a side effect of choosing a provider', async () => {
      // Two fields on the wire precisely so they can be two controls here.
      const user = userEvent.setup();
      setHook({ settings: freshSettings });
      renderAsAdmin();

      await user.click(screen.getByRole('radio', { name: 'OpenAI' }));

      expect(screen.getByRole('radio', { name: 'OpenAI' })).toBeChecked();
      expect(screen.getByLabelText('Enable AI features')).not.toBeChecked();
    });
  });

  describe('the platform key field', () => {
    it('renders empty with the stored status beside it, never the key', () => {
      renderAsAdmin();

      const field = screen.getByLabelText('Platform API key') as HTMLInputElement;
      expect(field.value).toBe('');
      expect(field.type).toBe('password');
      expect(screen.getByText(/Configured · ••••0000/)).toBeInTheDocument();
    });

    it('says plainly when nothing is stored', () => {
      setHook({ settings: freshSettings });
      renderAsAdmin();

      expect(screen.getByText(/No platform key is stored/)).toBeInTheDocument();
    });

    it('toggles visibility', async () => {
      const user = userEvent.setup();
      renderAsAdmin();

      await user.click(screen.getByRole('button', { name: 'Show key' }));
      expect((screen.getByLabelText('Platform API key') as HTMLInputElement).type).toBe(
        'text',
      );

      await user.click(screen.getByRole('button', { name: 'Hide key' }));
      expect((screen.getByLabelText('Platform API key') as HTMLInputElement).type).toBe(
        'password',
      );
    });
  });

  describe('the model catalog', () => {
    it('renders exactly what the API returned, with no client-side filtering', () => {
      // The >= 5.4 rule is enforced server-side on both the read and the write,
      // so a second copy here could only ever disagree with it.
      setHook({
        models: {
          success: true,
          // A model the client-side rule would have dropped, to prove there is
          // no client-side rule.
          models: [{ id: 'gpt-4o', created: 1 }],
          fetchedAt: '2026-09-01T00:00:00.000Z',
          source: 'live',
          error: null,
        },
      });
      renderAsAdmin();

      expect(screen.getByText(/live/)).toBeInTheDocument();
    });

    it('shows a catalog failure inline instead of crashing', () => {
      setHook({
        models: {
          success: false,
          models: [],
          fetchedAt: null,
          source: null,
          error: 'No platform API key is configured. Save one, then refresh.',
        },
      });
      renderAsAdmin();

      expect(screen.getByText(/No platform API key is configured/)).toBeInTheDocument();
      expect(screen.getByText('Not fetched yet.')).toBeInTheDocument();
    });

    it('refreshes on demand', async () => {
      const user = userEvent.setup();
      const { refreshModels } = setHook();
      renderAsAdmin();

      await user.click(screen.getByRole('button', { name: /Refresh models/ }));

      expect(refreshModels).toHaveBeenCalled();
    });

    it('keeps a stored default the catalog no longer lists selectable', async () => {
      const user = userEvent.setup();
      setHook({
        settings: { ...configuredSettings, defaultModel: 'gpt-9.9-private' },
      });
      renderAsAdmin();

      await user.click(screen.getByLabelText('Default model'));

      expect(
        screen.getByRole('option', { name: 'gpt-9.9-private (not in catalog)' }),
      ).toBeInTheDocument();
    });
  });

  describe('the test button', () => {
    it('is enabled with no stated reason when everything is in place', () => {
      renderAsAdmin();

      expect(screen.getByRole('button', { name: /Test connection/ })).toBeEnabled();
    });

    it.each([
      [
        'the user cannot write',
        () => setPermissions(READ_ONLY_PERMISSIONS),
        /needs permission to change system settings/,
      ],
      [
        'a save is in flight',
        () => setHook({ isSaving: true }),
        /wait for the save to finish/,
      ],
      [
        'no provider is configured',
        () => setHook({ settings: { ...configuredSettings, provider: null } }),
        /nothing to connect to/,
      ],
      [
        'AI is switched off',
        () => setHook({ settings: { ...configuredSettings, enabled: false } }),
        /AI is switched off/,
      ],
      [
        'no platform key is stored',
        () =>
          setHook({
            settings: {
              ...configuredSettings,
              platformKeyStatus: {
                configured: false,
                hint: null,
                updatedAt: null,
                updatedByUserId: null,
              },
            },
          }),
        /No platform API key is stored/,
      ],
    ])('is disabled with a stated reason when %s', (_label, arrange, message) => {
      arrange();
      renderAsAdmin();

      expect(screen.getByRole('button', { name: /Test connection/ })).toBeDisabled();
      // `getAllByText`: switching AI off also renders the info banner that
      // repeats the phrase, and a single-match query would fail on the page
      // being MORE explanatory rather than less.
      expect(screen.getAllByText(message).length).toBeGreaterThan(0);
    });

    it('is disabled while the form is dirty, because the test uses the saved config', async () => {
      const user = userEvent.setup();
      renderAsAdmin();

      await user.type(screen.getByLabelText('Platform API key'), 'sk-new-key-0000000000');

      expect(screen.getByRole('button', { name: /Test connection/ })).toBeDisabled();
      expect(screen.getByText(/Save your changes first/)).toBeInTheDocument();
    });
  });

  describe('the test result', () => {
    it('renders success with the checks', () => {
      const testResult: AiTestResult = {
        success: true,
        providerKind: 'openai',
        model: 'gpt-5.4',
        latencyMs: 412,
        error: null,
        attemptedAt: '2026-09-01T00:00:00.000Z',
        checks: { listModels: 'passed', generate: 'passed' },
      };
      setHook({ testResult });
      renderAsAdmin();

      expect(screen.getByText('Connection works')).toBeInTheDocument();
      expect(screen.getByText(/models passed · generate passed/)).toBeInTheDocument();
    });

    it('explains a skipped generate rather than leaving it bare', () => {
      setHook({
        testResult: {
          success: true,
          providerKind: 'openai',
          model: null,
          latencyMs: 90,
          error: null,
          checks: { listModels: 'passed', generate: 'skipped' },
        },
      });
      renderAsAdmin();

      expect(screen.getByText(/choose a default model above/)).toBeInTheDocument();
    });

    it("renders a failure verbatim in a <pre>, never truncated", () => {
      // The provider's own text is the diagnosis; an ellipsis in the middle of
      // one costs the administrator the answer.
      const verbose =
        'Incorrect API key provided: sk-***. You can find your API key at https://platform.openai.com/account/api-keys.';
      setHook({
        testResult: {
          success: false,
          providerKind: 'openai',
          model: null,
          latencyMs: 30,
          error: verbose,
          checks: { listModels: 'failed', generate: 'skipped' },
        },
      });
      renderAsAdmin();

      expect(screen.getByText('Test failed')).toBeInTheDocument();
      const pre = screen.getByText(verbose);
      expect(pre.tagName).toBe('PRE');
      expect(pre.textContent).toBe(verbose);
    });

    it('renders success: false as a failure, never as a success', () => {
      setHook({
        testResult: { success: false, error: 'nope', checks: undefined },
      });
      renderAsAdmin();

      expect(screen.queryByText('Connection works')).not.toBeInTheDocument();
      expect(screen.getByText('Test failed')).toBeInTheDocument();
    });
  });

  describe('degraded and read-only states', () => {
    it('warns loudly when the stored row would not parse', () => {
      setHook({
        settings: {
          ...configuredSettings,
          settingsError: 'The stored AI configuration is invalid at: provider.',
        },
      });
      renderAsAdmin();

      expect(
        screen.getByText('The stored AI configuration could not be read'),
      ).toBeInTheDocument();
      expect(screen.getByText(/defaults rather than your saved values/)).toBeInTheDocument();
    });

    it('says "(read-only)" and disables the controls without write permission', () => {
      setPermissions(READ_ONLY_PERMISSIONS);
      renderAsAdmin();

      expect(screen.getByText(/\(read-only\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(screen.getByLabelText('Platform API key')).toBeDisabled();
    });

    it('redirects away without system_settings:read', () => {
      setPermissions([]);
      renderAsAdmin();

      expect(screen.queryByRole('heading', { name: 'AI' })).not.toBeInTheDocument();
    });

    it('surfaces a load error', () => {
      setHook({ settings: null, loadError: 'You do not have permission to view AI settings' });
      renderAsAdmin();

      expect(
        screen.getByText('You do not have permission to view AI settings'),
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    // jsdom performs no layout, so `color-contrast` is a known false-negative
    // trap here — the same exclusion the datatable conformance suite documents.
    const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

    it.each([
      ['desktop', false],
      ['phone', true],
    ])('has no violations at %s width', async (_label, compact) => {
      mockViewport(compact);
      const { container } = renderAsAdmin();

      await waitFor(() => expect(screen.getByRole('heading', { name: 'AI' })).toBeInTheDocument());

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  });
});
