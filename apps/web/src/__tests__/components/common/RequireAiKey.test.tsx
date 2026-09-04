import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { RequireAiKey } from '../../../components/common/RequireAiKey';
import { AuthContext } from '../../../contexts/AuthContext';
import { mockUser } from '../../utils/test-utils';

/**
 * Renders the setup route and exposes the navigation state the gate attached,
 * so the "come back to where you were going" contract is asserted rather than
 * assumed.
 */
function SetupProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from;

  return (
    <div>
      <span>setup page</span>
      <span data-testid="from">{from?.pathname ?? 'none'}</span>
    </div>
  );
}

function renderAt(pathname: string, user: unknown) {
  return render(
    <AuthContext.Provider
      value={
        {
          user,
          isLoading: false,
          isAuthenticated: !!user,
          providers: [],
          login: vi.fn(),
          logout: vi.fn(),
          refreshUser: vi.fn(),
        } as never
      }
    >
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route path="/setup/ai-key" element={<SetupProbe />} />
          <Route element={<RequireAiKey />}>
            <Route path="/admin/settings" element={<div>shell content</div>} />
            <Route path="/settings/ai-key" element={<div>shell content</div>} />
            <Route path="/" element={<div>shell content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const withKey = { ...mockUser, aiKey: { configured: true, hint: '••••e2e1' } };
const withoutKey = { ...mockUser, aiKey: { configured: false, hint: null } };

describe('RequireAiKey', () => {
  it('renders the shell for a user with a key', () => {
    renderAt('/', withKey);

    expect(screen.getByText('shell content')).toBeInTheDocument();
  });

  it('redirects a keyless user to the setup page', () => {
    renderAt('/', withoutKey);

    expect(screen.getByText('setup page')).toBeInTheDocument();
    expect(screen.queryByText('shell content')).not.toBeInTheDocument();
  });

  it('carries the attempted location so the user can be returned to it', () => {
    renderAt('/admin/settings', withoutKey);

    expect(screen.getByTestId('from')).toHaveTextContent('/admin/settings');
  });

  it('gates admin routes too — an admin without a key cannot use the coach either', () => {
    renderAt('/admin/settings', {
      ...withoutKey,
      permissions: ['system_settings:read', 'system_settings:write'],
    });

    expect(screen.getByText('setup page')).toBeInTheDocument();
  });

  it('gates /settings/ai-key itself, which is what makes Remove send you back', () => {
    renderAt('/settings/ai-key', withoutKey);

    expect(screen.getByText('setup page')).toBeInTheDocument();
  });

  it('renders the outlet when there is no user, rather than racing ProtectedRoute', () => {
    // Signed-out is `ProtectedRoute`'s question, and it answers it by rendering
    // a redirect to /login instead of this subtree. Answering it here too would
    // send a signed-out user to setup instead of to login.
    renderAt('/', null);

    expect(screen.getByText('shell content')).toBeInTheDocument();
  });
});
