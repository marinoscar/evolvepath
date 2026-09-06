import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { RequireOnboarding } from '../../../components/common/RequireOnboarding';
import { AuthContext } from '../../../contexts/AuthContext';
import { mockUser } from '../../utils/test-utils';

/**
 * The onboarding gate (issue #106, epic E04). Modelled on
 * `RequireAiKey.test.tsx` — the shape and the `state={{ from }}` convention are
 * the same, deliberately.
 */
function WizardProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from;

  return (
    <div>
      <span>onboarding wizard</span>
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
          <Route path="/onboarding" element={<WizardProbe />} />
          <Route element={<RequireOnboarding />}>
            <Route path="/" element={<div>shell content</div>} />
            <Route path="/settings" element={<div>shell content</div>} />
            <Route path="/settings/ai-key" element={<div>shell content</div>} />
            <Route path="/admin/settings" element={<div>shell content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const onboarded = { ...mockUser, onboarding: { completed: true } };
const unonboarded = { ...mockUser, onboarding: { completed: false } };

describe('RequireOnboarding', () => {
  it('renders the shell for a user with a Path', () => {
    renderAt('/', onboarded);

    expect(screen.getByText('shell content')).toBeInTheDocument();
  });

  it.each(['/', '/settings', '/settings/ai-key', '/admin/settings'])(
    'sends an un-onboarded user from %s to the wizard',
    (pathname) => {
      renderAt(pathname, unonboarded);

      expect(screen.getByText('onboarding wizard')).toBeInTheDocument();
      expect(screen.queryByText('shell content')).not.toBeInTheDocument();
    },
  );

  it('carries the attempted location so the user can be returned to it', () => {
    renderAt('/admin/settings', unonboarded);

    expect(screen.getByTestId('from')).toHaveTextContent('/admin/settings');
  });

  it('gates admins too — an admin without a Path has an empty console as well', () => {
    renderAt('/admin/settings', {
      ...unonboarded,
      roles: [{ name: 'admin' }],
      permissions: ['system_settings:read', 'users:read'],
    });

    expect(screen.getByText('onboarding wizard')).toBeInTheDocument();
  });

  it('renders the outlet for a null user — that is ProtectedRoute’s question', () => {
    renderAt('/', null);

    expect(screen.getByText('shell content')).toBeInTheDocument();
    expect(screen.queryByText('onboarding wizard')).not.toBeInTheDocument();
  });

  describe('an API that does not report onboarding', () => {
    beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
    afterEach(() => vi.restoreAllMocks());

    it('lets the user through rather than looping them into the wizard forever', () => {
      const { onboarding: _dropped, ...withoutField } = onboarded;

      renderAt('/', withoutField);

      expect(screen.getByText('shell content')).toBeInTheDocument();
    });
  });
});
