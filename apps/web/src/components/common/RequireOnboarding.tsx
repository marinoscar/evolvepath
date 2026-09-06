/**
 * The onboarding gate (issue #106, epic E04).
 *
 * PRD §101's Day 0 has the user reach Today only after their first Path exists.
 * Today with no commitments is an empty screen and Path with no Best Self is an
 * empty tree — so a signed-in, keyed, un-onboarded user is sent to the wizard
 * rather than into a shell that has nothing in it.
 *
 * -----------------------------------------------------------------------------
 * THIS IS UX, NOT AUTHORIZATION
 * -----------------------------------------------------------------------------
 *
 * Nothing here protects anything, exactly as `RequireAiKey` says of itself.
 * Every API route remains independently authorised; deleting this component
 * would make the app confusing, not insecure. Say so before adding a "we
 * already checked onboarding on the client" shortcut to some future endpoint.
 *
 * -----------------------------------------------------------------------------
 * A SIBLING OF `RequireAiKey`, NOT AN EDIT TO IT
 * -----------------------------------------------------------------------------
 *
 * Three questions, three components, in one order: is anyone signed in
 * (`ProtectedRoute`), do they have a key (`RequireAiKey`), do they have a Path
 * (this). Folding any two together would give one component two unrelated
 * redirect conditions and invalidate its existing tests.
 *
 * IT RENDERS `Outlet` WHEN `user` IS NULL, deliberately — that state is
 * `ProtectedRoute`'s and it has already answered it. Two components racing to
 * answer one question is how a signed-out user ends up on the wizard instead of
 * on login.
 *
 * IT ALSO RENDERS `Outlet` WHEN `user.onboarding` IS ABSENT. An older API that
 * does not send the field must not produce a redirect loop for every user of a
 * newly-deployed web app; treating "the server did not say" as "onboarded" is
 * the only reading that degrades to the app working.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/** Warned once per page load, not once per render. */
let warnedAboutMissingField = false;

export function RequireOnboarding() {
  const { user } = useAuth();
  const location = useLocation();

  if (user && !user.onboarding) {
    if (!warnedAboutMissingField) {
      warnedAboutMissingField = true;
      console.warn(
        'RequireOnboarding: /auth/me did not report onboarding state; treating the user as onboarded.',
      );
    }

    return <Outlet />;
  }

  if (user && !user.onboarding.completed) {
    // `state.from` so the wizard's own completion can return the user to where
    // they were actually going — a bookmark into `/progress` should survive the
    // detour rather than dumping them on the home screen.
    return <Navigate to="/onboarding" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
