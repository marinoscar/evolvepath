import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, ApiError, AI_KEY_REQUIRED_EVENT } from '../services/api';
import { User, AuthProvider as AuthProviderType } from '../types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  providers: AuthProviderType[];
  login: (provider: string) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [providers, setProviders] = useState<AuthProviderType[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const initRef = useRef(false);

  // Fetch auth providers on mount
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await api.get<{ providers: AuthProviderType[] }>('/auth/providers', {
          skipAuth: true,
        });
        setProviders(response.providers);
      } catch (error) {
        console.error('Failed to fetch auth providers:', error);
      }
    };
    fetchProviders();
  }, []);

  // Check for existing session on mount (runs only once)
  useEffect(() => {
    // Skip if already initialized or on auth callback page
    // (the callback page will set the token directly from URL params)
    if (initRef.current || location.pathname === '/auth/callback') {
      setIsLoading(false);
      return;
    }
    initRef.current = true;

    const initAuth = async () => {
      try {
        // Try to refresh token (uses httpOnly cookie)
        const refreshed = await api.refreshToken();
        if (refreshed) {
          await fetchUser();
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
      } finally {
        setIsLoading(false);
      }
    };
    initAuth();
  }, [location.pathname]);

  const fetchUser = useCallback(async () => {
    try {
      const userData = await api.get<User>('/auth/me');
      setUser(userData);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        api.setAccessToken(null);
      }
      throw error;
    }
  }, []);

  const login = useCallback((provider: string) => {
    // Store return URL for redirect after login (including query params)
    const fromLocation = location.state?.from;
    const returnUrl = fromLocation
      ? `${fromLocation.pathname}${fromLocation.search || ''}`
      : '/';
    sessionStorage.setItem('auth_return_url', returnUrl);

    // Redirect to OAuth provider
    window.location.href = `/api/auth/${provider}`;
  }, [location.state]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      api.setAccessToken(null);
      navigate('/login');
    }
  }, [navigate]);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  /**
   * Re-read the user when an API call reports that a key is required
   * (issue #29, epic #20).
   *
   * `user.aiKey.configured` is only as fresh as the last `/auth/me`, so a key
   * removed in another tab leaves THIS tab inside a shell it can no longer use.
   * The API layer dispatches `AI_KEY_REQUIRED_EVENT` on a 412; re-reading here
   * flips the flag, and `RequireAiKey` redirects on the next render.
   *
   * Only when there IS a user: a 412 on a signed-out tab is not a thing this
   * can fix, and re-fetching would produce a 401 and a spurious sign-out.
   */
  useEffect(() => {
    if (!user) return;

    const handler = () => {
      void fetchUser();
    };

    window.addEventListener(AI_KEY_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(AI_KEY_REQUIRED_EVENT, handler);
  }, [user, fetchUser]);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    providers,
    login,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
