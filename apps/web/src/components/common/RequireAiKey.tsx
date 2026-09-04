/**
 * The AI-key gate (issue #29, epic #20).
 *
 * Every user of EvolvePath brings their own OpenAI key — that is a
 * product-owner constraint, and it means the app has nothing to offer a
 * signed-in user who has not supplied one. This layout route sends them to
 * `/setup/ai-key` instead of into a shell whose every feature would answer 412.
 *
 * -----------------------------------------------------------------------------
 * THIS IS UX, NOT AUTHORIZATION
 * -----------------------------------------------------------------------------
 *
 * Nothing here protects anything. Authorization stays server-side: the gateway
 * (#26) returns `no_user_key` and HTTP callers turn that into a 412, whatever
 * the browser believes. Deleting this component would make the app unpleasant,
 * not insecure. Say so before adding a "just check the key here" shortcut to
 * some future endpoint.
 *
 * -----------------------------------------------------------------------------
 * A SIBLING OF `ProtectedRoute`, NOT AN EDIT TO IT
 * -----------------------------------------------------------------------------
 *
 * `ProtectedRoute` answers "is anyone signed in?" and spins while
 * `AuthContext` is loading. Folding this question into it would give one
 * component two unrelated redirect conditions and invalidate its existing
 * tests. As a separate layout route it composes: `ProtectedRoute` resolves
 * first, so by the time this renders `isLoading` is already false and there is
 * no flash-redirect to guard against.
 *
 * IT RENDERS `Outlet` WHEN `user` IS NULL, deliberately. That state is
 * `ProtectedRoute`'s to handle, and it already has: it renders a `Navigate` to
 * `/login` rather than this subtree. Redirecting here too would mean two
 * components racing to answer one question, and a keyless-and-signed-out user
 * would land on the setup page instead of on login.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function RequireAiKey() {
  const { user } = useAuth();
  const location = useLocation();

  if (user && !user.aiKey.configured) {
    // `state.from` so the setup page can return the user to where they were
    // actually going — a bookmark into `/admin/settings` should survive the
    // detour rather than dumping them on the home screen.
    return <Navigate to="/setup/ai-key" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
