import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { AuthContext } from '../../contexts/AuthContext';
import { server } from '../mocks/server';
import { resetAiKeyState, setAiKeyConfigured } from '../mocks/handlers';
import { mockUser } from '../utils/test-utils';
import AiKeySetupPage from '../../pages/AiKeySetupPage';

const logout = vi.fn().mockResolvedValue(undefined);
const refreshUser = vi.fn().mockResolvedValue(undefined);

function renderPage({
  configured = false,
  from,
}: { configured?: boolean; from?: string } = {}) {
  const user = { ...mockUser, aiKey: { configured, hint: configured ? '••••e2e1' : null } };

  return render(
    <AuthContext.Provider
      value={
        {
          user,
          isLoading: false,
          isAuthenticated: true,
          providers: [],
          login: vi.fn(),
          logout,
          refreshUser,
        } as never
      }
    >
      <MemoryRouter
        initialEntries={[
          { pathname: '/setup/ai-key', state: from ? { from: { pathname: from } } : null },
        ]}
      >
        <Routes>
          <Route path="/setup/ai-key" element={<AiKeySetupPage />} />
          <Route path="/" element={<div>home</div>} />
          <Route path="/login" element={<div>login</div>} />
          <Route path="/admin/settings" element={<div>admin settings</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('AiKeySetupPage', () => {
  beforeEach(() => {
    server.resetHandlers();
    resetAiKeyState();
    setAiKeyConfigured(false);
    logout.mockClear();
    refreshUser.mockClear();
  });

  it('explains itself and shows the instructions open', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Connect your OpenAI API key' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/runs every AI feature with your own key/)).toBeInTheDocument();
    // Open, unlike the settings page: the user has never done this before.
    expect(screen.getByText(/Create new secret key/)).toBeVisible();
  });

  it('has no app chrome — no app bar, no rail, no bottom nav', () => {
    // The honest rendering: none of those destinations work yet, so offering
    // them would invite the user to bounce off the gate repeatedly.
    renderPage();

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bottom-nav')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('offers Sign out as the only other way off the page', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByText('login')).toBeInTheDocument();
  });

  it('does not offer Remove — there is nothing to return to', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: 'Remove key' })).not.toBeInTheDocument();
  });

  it('labels the save button for the setup flow', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save key' })).not.toBeInTheDocument();
  });

  it('sends a user who already has a key straight on', async () => {
    // A bookmark or a stale link. Being asked for something already given reads
    // as the app having lost it.
    renderPage({ configured: true });

    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('returns a user with a key to the route they originally asked for', async () => {
    renderPage({ configured: true, from: '/admin/settings' });

    expect(await screen.findByText('admin settings')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    // jsdom performs no layout, so `color-contrast` is a known false-negative
    // trap — the same exclusion the datatable conformance suite documents.
    const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

    it('has no violations', async () => {
      const { container } = renderPage();

      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: 'Connect your OpenAI API key' }),
        ).toBeInTheDocument(),
      );

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  });
});
