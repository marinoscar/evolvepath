import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeContextProvider, useThemeContext } from './contexts/ThemeContext';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { RequireAiKey } from './components/common/RequireAiKey';
import { RequirePermission } from './components/common/RequirePermission';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Pages (lazy loaded)
import { Suspense, lazy } from 'react';
import { LoadingSpinner } from './components/common/LoadingSpinner';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const ActivateDevicePage = lazy(() => import('./pages/ActivateDevicePage'));
// The five product destinations (PRD §11, #51). Today, Coach and Progress are
// placeholders until E05, E06 and E11; Path is replaced wholesale by #56.
const TodayPage = lazy(() => import('./pages/TodayPage'));
const StartFlowPage = lazy(() => import('./pages/StartFlowPage'));
const PathPage = lazy(() => import('./pages/PathPage'));
// The outcome drill-down (#56). Its own route at every width — see the page's
// header for why a master/detail split above `sm` was rejected.
const OutcomeDetailPage = lazy(() => import('./pages/OutcomeDetailPage'));
// A Path surface, not a sixth destination: `DESTINATION_ROUTES.path` already
// owns `/path/family` by prefix, so no registry entry is needed (epic E08).
const FamilyPage = lazy(() => import('./pages/FamilyPage'));
// The Health surface (epic E09). `DESTINATION_ROUTES.path` lists `/health`
// explicitly — the URL does not start with `/path`, but the destination it
// belongs to is Path.
const HealthPage = lazy(() => import('./pages/HealthPage'));
const WorkoutProgramsPage = lazy(() => import('./pages/WorkoutProgramsPage'));
const ProgramBuilderPage = lazy(() => import('./pages/ProgramBuilderPage'));
const WorkoutProgramPage = lazy(() => import('./pages/WorkoutProgramPage'));
const CoachPage = lazy(() => import('./pages/CoachPage'));
const ProgressPage = lazy(() => import('./pages/ProgressPage'));
// Progress surfaces, not sixth destinations: `DESTINATION_ROUTES.progress`
// already owns `/progress/*` by prefix, so the weekly review and its planning
// wizard need no registry entry (epic E10).
const WeeklyReviewPage = lazy(() => import('./pages/WeeklyReviewPage'));
const WeeklyPlanPage = lazy(() => import('./pages/WeeklyPlanPage'));
// User settings — the hub (#96) plus one route per card in
// `config/userSettingsSections.tsx` (#91, epic #90). These replace the single
// stacked `UserSettingsPage`, which is deleted rather than left unrouted.
const UserSettingsHubPage = lazy(() => import('./pages/UserSettingsHubPage'));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'));
// `User`-prefixed to keep it distinct from `Admin/AppearanceSettingsPage`
// below: one is the user's own theme, the other the deployment's default.
const UserAppearancePage = lazy(() => import('./pages/UserAppearancePage'));
// Issue #126, epic #109 — the per-user event x channel notification matrix.
const UserNotificationsPage = lazy(() => import('./pages/UserNotificationsPage'));
const UserTokensPage = lazy(() => import('./pages/UserTokensPage'));
const UserAiKeyPage = lazy(() => import('./pages/UserAiKeyPage'));
const UserAiMemoryPage = lazy(() => import('./pages/UserAiMemoryPage'));
// Epic E10 (#84) — the day and time the weekly review is prepared.
const UserWeeklyRhythmPage = lazy(() => import('./pages/UserWeeklyRhythmPage'));
const AiKeySetupPage = lazy(() => import('./pages/AiKeySetupPage'));

// Console — the hub (#93) plus one route per card in
// `config/adminSections.tsx` (#92, epic #90).
const SettingsHubPage = lazy(() => import('./pages/Admin/SettingsHubPage'));
const GeneralSettingsPage = lazy(() => import('./pages/Admin/GeneralSettingsPage'));
const AppearanceSettingsPage = lazy(() => import('./pages/Admin/AppearanceSettingsPage'));
const FeatureFlagsPage = lazy(() => import('./pages/Admin/FeatureFlagsPage'));
// Issue #124, epic #109 — the admin email configuration and its test send.
const EmailSettingsPage = lazy(() => import('./pages/Admin/EmailSettingsPage'));
const AiSettingsPage = lazy(() => import('./pages/Admin/AiSettingsPage'));
const AdvancedSettingsPage = lazy(() => import('./pages/Admin/AdvancedSettingsPage'));
const AdminUsersPage = lazy(() => import('./pages/Admin/UsersPage'));

// Test login page (development only)
const TestLoginPage = import.meta.env.PROD
  ? null
  : lazy(() => import('./pages/TestLoginPage'));

function AppRoutes() {
  const { theme } = useThemeContext();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner fullScreen />}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Test login (development only) */}
            {!import.meta.env.PROD && TestLoginPage && (
              <Route path="/testing/login" element={<TestLoginPage />} />
            )}

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              {/* Device activation page - without layout for full-screen experience */}
              <Route path="/activate" element={<ActivateDevicePage />} />

              {/* THE TWO ROUTES EXEMPT FROM THE AI-KEY GATE, and the only two
                  (#29, epic #20).

                  `/activate` because approving a device is a credential
                  operation that has nothing to do with AI, and a user holding a
                  device code in front of a TV should not be sent to a key form.

                  `/setup/ai-key` because it is the gate's own destination — a
                  gate that redirected its own target would loop forever.

                  Both sit outside `Layout` for the same reason: neither is a
                  place to offer navigation into a shell the user cannot yet
                  use. */}
              <Route path="/setup/ai-key" element={<AiKeySetupPage />} />

              {/* The notification centre (#127, epic #109) wraps the SHELL,
                  not the whole app, and that scoping is the point:

                    * It is INSIDE `ProtectedRoute`, so it only ever mounts for
                      an authenticated user. Every endpoint it calls is
                      `@Auth()`-guarded and every one resolves the recipient from
                      the JWT, so mounting it on `/login` would buy a burst of
                      401s and a stream that cannot connect.
                    * It is around `Layout` specifically, because `Layout`'s
                      `AppBar` is where the bell lives. `/activate` above sits
                      outside the shell on purpose (full-screen device flow) and
                      correspondingly gets no bell and opens no stream.

                  ONE MOUNT POINT, so there is exactly one SSE connection per
                  tab. A provider mounted per-page would open and close a stream
                  on every navigation, which the server sees as a connection
                  storm from a single user and the client experiences as a bell
                  that resets its state every time the route changes. */}
              {/* THE AI-KEY GATE (#29, epic #20). Wraps the whole shell —
                  `/admin/*` and `/settings/*` included — because every feature
                  inside it runs on the user's own OpenAI key, and an admin
                  without one cannot use the coach either.

                  `/settings/ai-key` is deliberately INSIDE it: removing a key
                  there sends the user back to setup, which is exactly what that
                  page's confirm dialog says will happen and what makes the
                  requirement real rather than decorative.

                  It is a LAYOUT ROUTE between `ProtectedRoute` and the shell
                  rather than an edit to `ProtectedRoute`, so the "is anyone
                  signed in?" question and the "do they have a key?" question
                  stay one component each. */}
              <Route element={<RequireAiKey />}>
                {/* The Start flow (#48, epic E05). INSIDE the gate — a session
                    can end with "Make it smaller", which is a coach call — but
                    OUTSIDE `Layout`, like `/activate` above. PRD §11 lets an
                    execution screen replace the navigation, and this is the one
                    screen where every other affordance is a way out of the thing
                    the user just committed to. `'/start'` is in
                    `UNOWNED_ROUTES` for the same reason: there is no rail or
                    bottom bar on it to highlight. */}
                <Route path="/start/:commitmentId" element={<StartFlowPage />} />

                <Route
                  element={
                    <NotificationProvider>
                      <Layout />
                    </NotificationProvider>
                  }
                >
                  <Route path="/" element={<TodayPage />} />
                  {/* `/today` is the SAME screen, not a redirect (#54, epic
                      E12). Every coaching deep link is written as
                      `/today?commitment=…&action=…`, because a notification
                      that reads "/?commitment=…" is a link nobody can sanity
                      check by looking at it. A redirect would work but would
                      cost a render and briefly show the bare Today screen
                      before the action ran. */}
                  <Route path="/today" element={<TodayPage />} />
                  <Route path="/path" element={<PathPage />} />
                  <Route path="/path/outcomes/:id" element={<OutcomeDetailPage />} />
                  <Route path="/path/family" element={<FamilyPage />} />
                  <Route path="/health" element={<HealthPage />} />
                  <Route path="/health/programs" element={<WorkoutProgramsPage />} />
                  <Route path="/health/programs/new" element={<ProgramBuilderPage />} />
                  <Route
                    path="/health/programs/:programId"
                    element={<WorkoutProgramPage />}
                  />
                  <Route path="/coach" element={<CoachPage />} />
                {/* One thread, its own URL. `/coach/:id` is what the narrow
                    layout navigates to and what a link to a conversation is;
                    `DESTINATION_ROUTES.coach` already owns the prefix, so the
                    rail lights up on both without a registry change. */}
                <Route path="/coach/:conversationId" element={<CoachPage />} />
                  <Route path="/progress" element={<ProgressPage />} />
                  {/* Epic E10. `/progress/week` rather than `/review`: the
                      review IS the weekly view of progress, so it belongs under
                      the destination whose rail and bottom-bar tab light up for
                      it — and no `DESTINATION_ROUTES` change is needed. */}
                  <Route path="/progress/week" element={<WeeklyReviewPage />} />
                  <Route path="/progress/week/plan" element={<WeeklyPlanPage />} />
                  {/* The per-user settings surface (#96, epic #90) — the same
                      hub component `/admin/settings` renders, over
                      `USER_SETTINGS_SECTIONS`, plus one route per card.

                      NONE OF THESE IS WRAPPED IN `RequirePermission`, and that is
                      the deliberate difference from the `/admin/settings/*` block
                      below rather than an oversight. `ProtectedRoute` above
                      establishes that someone is signed in, and that is the only
                      question these routes have: they edit the caller's OWN
                      settings, which the API grants to all three roles, and
                      `config/userSettingsSections.tsx` correspondingly declares no
                      `permission` on any card. A gate here would deny a Viewer
                      their own display name.

                      As above, declaration order does not matter — React Router
                      v6 ranks by specificity, so `/settings/profile` beats
                      `/settings` wherever each is written. */}
                  <Route path="/settings" element={<UserSettingsHubPage />} />
                  <Route path="/settings/profile" element={<UserProfilePage />} />
                  <Route path="/settings/appearance" element={<UserAppearancePage />} />
                  {/* Ungated like its siblings (#126): these are the caller's own
                      preferences, and the registry endpoint the page renders is
                      itself `@Auth()` with no permission for the same reason. */}
                  <Route path="/settings/notifications" element={<UserNotificationsPage />} />
                  <Route path="/settings/tokens" element={<UserTokensPage />} />
                  {/* Epic #20. No `RequirePermission`: every authenticated user owns
                      their own key, and a Viewer without one cannot use the app at
                      all. Deliberately NOT exempt from the AI-key gate (#29) —
                      removing a key here sends the user to /setup/ai-key, which is
                      what the confirm dialog warns will happen. */}
                  <Route path="/settings/ai-key" element={<UserAiKeyPage />} />
                  {/* Epic E06 (#90). Ungated like its siblings: an insight is
                      the caller's own row and the API answers 404, not 403,
                      for anyone else's. */}
                  <Route path="/settings/ai-memory" element={<UserAiMemoryPage />} />
                  {/* Epic E10 (#84). Ungated like its siblings: the review
                      rhythm is two columns on the caller's own profile, and the
                      API route is plain `@Auth()` for the same reason. */}
                  <Route path="/settings/weekly-rhythm" element={<UserWeeklyRhythmPage />} />
                  {/* Route-level AUTHORIZATION, not just authentication.
                      `ProtectedRoute` above only establishes that someone is
                      logged in — before this, a Viewer typing `/admin/settings`
                      reached the page and only then watched every API call 403.
                      `RequirePermission` was already in the codebase but had zero
                      usages; wrapping these routes is what turns it into the
                      enforcement point.

                      The permission on each route is the SAME string its card
                      declares in `config/adminSections.tsx`, which is the same
                      string the API's controller enforces — so the hub card, the
                      rail row, the menu entry and the route can no longer
                      disagree about who may go where.

                      ORDER IS NOT SIGNIFICANT HERE. React Router v6 ranks routes
                      by specificity rather than by declaration order, so
                      `/admin/settings/users` beats `/admin/settings` regardless
                      of where each sits in this list. They are grouped by surface
                      for reading, not for matching. */}

                  {/* Both redirects are REAL ROUTES, not catch-all fallout.
                      Without them a bookmarked `/admin/users` matches only `*`
                      and lands silently on `/` — the user asked for a page that
                      still exists and got the home screen with no explanation.
                      `replace` keeps the dead URL out of the history stack, so
                      Back returns to wherever the user came from rather than
                      bouncing through the redirect again.

                      They sit INSIDE `ProtectedRoute` so an unauthenticated
                      bookmark goes to login and arrives here afterwards, rather
                      than being redirected first and losing the destination. */}
                  <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
                  <Route
                    path="/admin/users"
                    element={<Navigate to="/admin/settings/users" replace />}
                  />

                  {/* The Console hub (#93, epic #90) — the searchable, grouped
                      card grid that reads `ADMIN_SECTIONS`. It replaces the
                      three-tab placeholder that answered this route through #92,
                      whose tabs duplicated the four routes below. That
                      duplication is now gone: the hub NAVIGATES to those routes
                      instead of re-hosting them. */}
                  {/* ANY-OF, and the one route here that is not a single
                      permission. This gate MUST STAY IN SYNC WITH `console`'s
                      `anyPermission` in `config/destinations.ts` — the two lists
                      answer the same question ("may this user reach the admin
                      surface?") on two different surfaces, and #92 left them
                      disagreeing: the Console row appeared in the rail, bottom
                      bar, user menu and quick actions for a `users:read`-only
                      user, whose click then bounced straight back to `/`. That
                      split brain is exactly what `config/destinations.ts`'s
                      header says the destination model exists to prevent, so the
                      route follows the destination rather than the reverse.

                      `requireAll` defaults to `false`, so `permissions` is an OR
                      here — matching `anyPermission`'s semantics, not
                      `hasAllPermissions`'.

                      A `users:read`-only user consequently reaches this route
                      and — since #93 — sees a hub containing exactly the one card
                      that permission unlocks, instead of the placeholder page's
                      blanket access-denied state. The hub's own gate
                      (`visibleSettingsSections`) does that per CARD, which is why
                      this route only answers the coarser question "may this user
                      reach the admin surface at all?". The five child routes
                      below keep their single-permission gates: each is one
                      specific page with one specific permission. */}
                  <Route
                    path="/admin/settings"
                    element={
                      <RequirePermission
                        permissions={['system_settings:read', 'users:read']}
                        fallback={<Navigate to="/" replace />}
                      >
                        <SettingsHubPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/general"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <GeneralSettingsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/appearance"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AppearanceSettingsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/feature-flags"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <FeatureFlagsPage />
                      </RequirePermission>
                    }
                  />
                  {/* Issue #124, epic #109. Same permission string the `Email`
                      card declares in `config/adminSections.tsx`, which is the
                      same string the API's email-settings controller enforces on
                      its GET — the invariant `destinations.test.ts` asserts for
                      every card. `system_settings:read` and not `:write`: saving
                      and test-sending need write, and the page disables both
                      without it, but the configuration is worth READING for
                      anyone diagnosing why mail is not arriving. */}
                  <Route
                    path="/admin/settings/email"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <EmailSettingsPage />
                      </RequirePermission>
                    }
                  />
                  {/* Epic #20. Same string as the `AI` card in
                      `config/adminSections.tsx`, and the same `read`-not-`write`
                      reasoning as Email above: saving, refreshing the catalog and
                      testing all need write, and the page disables them without
                      it, but the configuration is worth READING for anyone
                      diagnosing why AI features are not responding. */}
                  <Route
                    path="/admin/settings/ai"
                    element={
                      <RequirePermission
                        permission="system_settings:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AiSettingsPage />
                      </RequirePermission>
                    }
                  />
                  {/* `system_settings:WRITE`, not `read`, and the one route here
                      whose permission differs from its siblings'. A raw editor
                      over the entire settings document has no read-only meaning —
                      see `config/adminSections.tsx`. */}
                  <Route
                    path="/admin/settings/advanced"
                    element={
                      <RequirePermission
                        permission="system_settings:write"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AdvancedSettingsPage />
                      </RequirePermission>
                    }
                  />
                  {/* `users:read` alone, even though the page also hosts the
                      allowlist. The route gate is about REACHABILITY and the page
                      is worth reaching for its Users tab; the Allowlist tab gates
                      its own content on `allowlist:read` inside the page. */}
                  <Route
                    path="/admin/settings/users"
                    element={
                      <RequirePermission
                        permission="users:read"
                        fallback={<Navigate to="/" replace />}
                      >
                        <AdminUsersPage />
                      </RequirePermission>
                    }
                  />
                </Route>
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ThemeContextProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeContextProvider>
  );
}
