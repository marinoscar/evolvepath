import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { AI_KEY_REQUIRED_EVENT } from '../../services/api';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

// Wrapper for hooks that need AuthProvider
function createAuthWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    );
  };
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should start in loading state', () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      // Initially should be in loading state
      expect(result.current.isLoading).toBe(true);
    });

    it('should be unauthenticated without valid token', async () => {
      // Override both refresh and me endpoints to simulate failed auth
      server.use(
        http.post('*/api/auth/refresh', () => {
          return new HttpResponse(null, { status: 401 });
        }),
        http.get('*/api/auth/me', () => {
          return new HttpResponse(null, { status: 401 });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should fetch providers on mount', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.providers).toHaveLength(1);
      });

      expect(result.current.providers[0].name).toBe('google');
    });
  });

  describe('Authentication', () => {
    it('should authenticate user when refresh succeeds', async () => {
      server.use(
        http.post('*/api/auth/refresh', () => {
          // Refresh endpoint returns token at root level (not wrapped in data)
          return HttpResponse.json({
            accessToken: 'test-token',
            expiresIn: 900,
          });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).not.toBeNull();
      expect(result.current.user?.email).toBe('test@example.com');
    });

    it('should handle logout', async () => {
      server.use(
        http.post('*/api/auth/refresh', () => {
          return HttpResponse.json({
            accessToken: 'test-token',
            expiresIn: 900,
          });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  describe('Login Flow', () => {
    it('should redirect to OAuth provider on login', async () => {
      // Override to prevent auth from happening during test setup
      server.use(
        http.post('*/api/auth/refresh', () => {
          return new HttpResponse(null, { status: 401 });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.providers).toHaveLength(1);
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Create a setter spy to track href changes
      let capturedHref = '';
      Object.defineProperty(window.location, 'href', {
        set: (value: string) => {
          capturedHref = value;
        },
        get: () => capturedHref || 'http://localhost:3000',
      });

      act(() => {
        result.current.login('google');
      });

      expect(capturedHref).toBe('/api/auth/google');
    });

    it('should store return URL before login', async () => {
      // Override to prevent auth from happening during test setup
      server.use(
        http.post('*/api/auth/refresh', () => {
          return new HttpResponse(null, { status: 401 });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.providers).toHaveLength(1);
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Create a setter spy to track href changes
      let capturedHref = '';
      Object.defineProperty(window.location, 'href', {
        set: (value: string) => {
          capturedHref = value;
        },
        get: () => capturedHref || 'http://localhost:3000',
      });

      act(() => {
        result.current.login('google');
      });

      const returnUrl = sessionStorage.getItem('auth_return_url');
      expect(returnUrl).toBe('/');
    });
  });

  describe('User Refresh', () => {
    it('should refresh user data', async () => {
      server.use(
        http.post('*/api/auth/refresh', () => {
          return HttpResponse.json({
            accessToken: 'test-token',
            expiresIn: 900,
          });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      // Wait for loading to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Wait for authentication to succeed
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      const originalEmail = result.current.user?.email;

      // Change the mock to return updated user data
      server.use(
        http.get('*/api/auth/me', () => {
          return HttpResponse.json({
            data: {
              id: 'test-user-id',
              email: 'updated@example.com',
              displayName: 'Updated User',
              roles: [{ name: 'viewer' }],
              permissions: ['user_settings:read', 'user_settings:write'],
              isActive: true,
            },
          });
        }),
      );

      await act(async () => {
        await result.current.refreshUser();
      });

      expect(result.current.user?.email).toBe('updated@example.com');
      expect(result.current.user?.email).not.toBe(originalEmail);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      server.use(
        http.post('*/api/auth/refresh', () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should handle logout errors', async () => {
      server.use(
        http.post('*/api/auth/refresh', () => {
          return HttpResponse.json({
            accessToken: 'test-token',
            expiresIn: 900,
          });
        }),
        http.post('*/api/auth/logout', () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      // Wait for loading to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Wait for authentication to succeed
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Logout should still clear user even if API fails
      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
    });

    it('should handle provider fetch errors', async () => {
      server.use(
        http.get('*/api/auth/providers', () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not crash, just have empty providers
      expect(result.current.providers).toEqual([]);
    });
  });

  describe('Context Usage', () => {
    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });

  /**
   * The AI-key-required listener (issue #29, epic #20).
   *
   * `user.aiKey.configured` is only as fresh as the last `/auth/me`, so a key
   * removed in another tab leaves THIS tab inside a shell it can no longer use.
   * The API layer dispatches on a 412; this is the half that reacts.
   */
  describe('AI_KEY_REQUIRED event', () => {
    it('re-reads the user when the event fires', async () => {
      server.use(
        http.post('*/api/auth/refresh', () =>
          HttpResponse.json({ accessToken: 'test-token', expiresIn: 900 }),
        ),
      );

      let meCalls = 0;
      server.use(
        http.get('*/api/auth/me', () => {
          meCalls += 1;
          return HttpResponse.json({
            data: {
              id: 'test-user-id',
              email: 'test@example.com',
              displayName: 'Test User',
              profileImageUrl: null,
              roles: [{ name: 'viewer' }],
              permissions: [],
              isActive: true,
              createdAt: new Date().toISOString(),
              // The state the event exists to reveal.
              aiKey: { configured: meCalls > 1 ? false : true, hint: null },
            },
          });
        }),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
      expect(result.current.user?.aiKey.configured).toBe(true);

      await act(async () => {
        window.dispatchEvent(new CustomEvent(AI_KEY_REQUIRED_EVENT));
      });

      await waitFor(() => expect(result.current.user?.aiKey.configured).toBe(false));
    });

    it('ignores the event while signed out', async () => {
      // A 412 on a signed-out tab is not something a re-read can fix, and
      // fetching would produce a 401 and a spurious sign-out.
      server.use(
        http.post('*/api/auth/refresh', () => new HttpResponse(null, { status: 401 })),
        http.get('*/api/auth/me', () => new HttpResponse(null, { status: 401 })),
      );

      const { result } = renderHook(() => useAuth(), {
        wrapper: createAuthWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.isAuthenticated).toBe(false);

      let meCalls = 0;
      server.use(
        http.get('*/api/auth/me', () => {
          meCalls += 1;
          return new HttpResponse(null, { status: 401 });
        }),
      );

      await act(async () => {
        window.dispatchEvent(new CustomEvent(AI_KEY_REQUIRED_EVENT));
      });

      expect(meCalls).toBe(0);
    });
  });
});
