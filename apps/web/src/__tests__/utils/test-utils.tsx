import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { vi } from 'vitest';

// Import AuthContext and ThemeContextProvider
import { AuthContext } from '../../contexts/AuthContext';
import { ThemeContextProvider } from '../../contexts/ThemeContext';
import type { AuthProvider as AuthProviderType } from '../../types';

interface WrapperOptions {
  route?: string;
  /**
   * Router location state for the initial entry (epic E11, #119).
   *
   * `StartFlowPage` reads `state.returnTo` to decide where a finished session
   * goes; without this a spec could only exercise the default.
   */
  routeState?: unknown;
  theme?: 'light' | 'dark';
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
}

export interface MockUser {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: { name: string }[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
  /**
   * Epic #20. Required on the real `User`, so it is required here: `RequireAiKey`
   * (#29) gates the whole shell on it, and a fixture without it would make every
   * page test render the setup page instead of the page under test.
   */
  aiKey: { configured: boolean; hint: string | null };
}

export const mockUser: MockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  profileImageUrl: null,
  roles: [{ name: 'viewer' }],
  permissions: ['user_settings:read', 'user_settings:write'],
  isActive: true,
  createdAt: new Date().toISOString(),
  // Configured, so a page test renders the page under test rather than the
  // AI-key setup gate (#29). A spec that wants the keyless state overrides it.
  aiKey: { configured: true, hint: '\u2022\u2022\u2022\u2022e2e1' },
};

export const mockAdminUser: MockUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  profileImageUrl: null,
  roles: [{ name: 'admin' }],
  permissions: [
    'user_settings:read',
    'user_settings:write',
    'system_settings:read',
    'system_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
    // Present because the seeded `admin` role grants them
    // (apps/api/prisma/seed.ts). The Allowlist tab gates on `allowlist:read`,
    // so an admin fixture missing it would test a user that cannot exist.
    'allowlist:read',
    'allowlist:write',
  ],
  isActive: true,
  createdAt: new Date().toISOString(),
  aiKey: { configured: true, hint: '\u2022\u2022\u2022\u2022e2e1' },
};

// Default mock providers
const defaultMockProviders: AuthProviderType[] = [
  { name: 'google', authUrl: '/api/auth/google' },
];

// Mock Auth Provider for testing
interface MockAuthProviderProps {
  children: ReactNode;
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
}

function MockAuthProvider({
  children,
  authenticated = true,
  user = mockUser,
  isLoading = false,
  providers = defaultMockProviders,
}: MockAuthProviderProps) {
  const contextValue = {
    user: authenticated ? user : null,
    isLoading,
    isAuthenticated: authenticated,
    providers,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn().mockResolvedValue(undefined),
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

function createWrapper(options: WrapperOptions = {}) {
  const {
    route = '/',
    routeState,
    authenticated = true,
    user = mockUser,
    isLoading = false,
    providers = defaultMockProviders,
  } = options;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter
        initialEntries={[routeState === undefined ? route : { pathname: route, state: routeState }]}
      >
        <ThemeContextProvider>
          <CssBaseline />
          <MockAuthProvider
            authenticated={authenticated}
            user={user}
            isLoading={isLoading}
            providers={providers}
          >
            {children}
          </MockAuthProvider>
        </ThemeContextProvider>
      </MemoryRouter>
    );
  };
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapperOptions?: WrapperOptions;
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {},
): RenderResult {
  const { wrapperOptions, ...renderOptions } = options;

  return render(ui, {
    wrapper: createWrapper(wrapperOptions),
    ...renderOptions,
  });
}

// Re-export everything from testing library
export * from '@testing-library/react';
export { renderWithProviders as render };
