/**
 * The destination model — canonical keys, route ownership, and active state.
 *
 * Issue #55, epic #51. This file is the SINGLE source of truth for the app's
 * navigation targets. Before it existed the same four menu paths were spelled
 * out in four places (`App.tsx`, `Sidebar.tsx`, `UserMenu.tsx`,
 * `home/QuickActions.tsx`, since removed), each with its own idea of who was allowed to see
 * them — which is how a Contributor holding `system_settings:read` ended up
 * with a working System Settings page, a menu entry pointing at it, and no
 * sidebar row: three gates, three answers.
 *
 * Two rules make the ownership table trustworthy:
 *
 *  1. **A route is owned by at most one destination.** A test asserts this
 *     against the live route list in `App.tsx`, which is what keeps the table
 *     honest as routes are added — it fails loudly the day someone adds a
 *     route and forgets this file.
 *  2. **Matching respects segment boundaries.** A bare `startsWith` — what
 *     `Sidebar` used to do — would make `/settings` own `/settingsfoo` and
 *     `/admin/users` own `/admin/users-archive`.
 *
 * `Icon` is declared as a COMPONENT, never as a rendered element. The rail
 * draws it at `small` when collapsed and `medium` when expanded, and the
 * bottom bar draws it at its own size — so the size cannot be baked in here.
 *
 * ONE ADMIN DESTINATION, NOT TWO (issue #92, epic #90)
 * ----------------------------------------------------
 * `users` (`/admin/users`) and `system` (`/admin/settings`) used to be two
 * separate rows for what is, to the user, one surface. Issue #92 splits the
 * admin tab strips into one route per settings page under `/admin/settings/*`,
 * and #94 gives the rail a Console mode that swaps its contents to those pages
 * on any `/admin/*` path. Console mode is only coherent if the admin surface is
 * ONE destination: two rows both matching `/admin/*` means two `aria-current`
 * candidates and an ambiguous active state on every admin route. So the two are
 * replaced by a single `console` destination that owns the whole `/admin`
 * subtree.
 */

import type { SvgIconComponent } from '@mui/icons-material';
import TodayIcon from '@mui/icons-material/Today';
import RouteIcon from '@mui/icons-material/Route';
import ForumIcon from '@mui/icons-material/Forum';
import InsightsIcon from '@mui/icons-material/Insights';
import PersonIcon from '@mui/icons-material/Person';
import AdminIcon from '@mui/icons-material/AdminPanelSettings';

export type DestinationKey =
  | 'today'
  | 'path'
  | 'coach'
  | 'progress'
  | 'profile'
  | 'console';

/**
 * Does `prefix` own `path`? True when the path equals the prefix or continues
 * with a `/`. `'/'` matches only itself — every path starts with it, so the
 * root has to be exact or Home would own the entire app.
 */
export function owns(prefix: string, path: string): boolean {
  if (prefix === '/') return path === '/';
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Route prefixes each destination owns. Child routes are covered by their
 * parent prefix (`/admin/settings/users`, `/settings/profile`, …) and do not
 * need their own entries.
 *
 * `console` owns the bare `/admin` rather than `/admin/settings`, even though
 * `/admin/settings` is where it NAVIGATES. The two are different questions:
 * `path` is where the row sends you, `DESTINATION_ROUTES` is what makes the row
 * light up. `/admin/users` still exists as a redirect route (#92) and a
 * bookmark still lands on it for one render — with only `/admin/settings` in
 * this list that render would highlight nothing, and the route-ownership test
 * would fail it as "neither owned nor deliberately unowned".
 */
export const DESTINATION_ROUTES: Record<DestinationKey, readonly string[]> = {
  // Both spellings of the Today screen (#54): `/today` is the form every
  // coaching deep link uses, and it must light this destination up exactly as
  // `/` does — it is the same route element, not a redirect.
  today: ['/', '/today'],
  // `/health` sits under Path for the same reason `/path/family` does: PRD §11
  // fixes five destinations, and the Health surface is a product screen rather
  // than a sixth place to go. Listed explicitly because the path does not start
  // with `/path` — the label and the URL answer different questions.
  path: ['/path', '/health'],
  // `/media` belongs to Coach, not to a sixth destination: media is something
  // you hand the coach, and the library is where you read what it said back
  // (epic E03). A route owned by no destination has no active state and no
  // AppBar title.
  coach: ['/coach', '/media'],
  progress: ['/progress'],
  // `/settings`, not `/profile`. The destination is LABELLED Profile because
  // that is what PRD §11 calls it, but the route stays the settings hub so
  // `USER_SETTINGS_SECTIONS`, the AppBar's drill-down titles and every
  // existing bookmark stay valid. Label and route answer different questions.
  profile: ['/settings'],
  console: ['/admin'],
};

/**
 * Routes deliberately owned by NO destination.
 *
 * These are reached from outside the authenticated shell entirely — the login
 * flow, the OAuth round trip, the device-activation screen — and most do not
 * even mount `Layout`. **On these routes no destination renders as active, and
 * that is correct rather than a bug.** Exported so a test can assert it
 * explicitly, which is what stops a future contributor from "fixing" it into
 * highlighting something arbitrary.
 */
export const UNOWNED_ROUTES: readonly string[] = [
  '/login',
  '/auth/callback',
  '/activate',
  '/testing/login',
  // The AI-key gate's own destination (#29, epic #20). Like `/activate`, it
  // renders OUTSIDE `Layout` — there is no rail and no bottom bar on it to
  // highlight, and a user who is on it cannot reach any destination anyway.
  '/setup/ai-key',
  // The onboarding wizard (#102, epic E04). Outside `Layout` for the same
  // reason `/setup/ai-key` is: every destination is empty until this flow
  // finishes, so there is nothing to highlight and nowhere useful to go.
  '/onboarding',
  // The Start flow (#48, epic E05). PRD §11 lets an execution screen replace
  // the navigation entirely: it renders outside `Layout`, so there is no rail
  // and no bottom bar on it to highlight. Listed as the route App.tsx declares,
  // parameter and all, because the ownership test compares these strings to
  // that file's `path` props verbatim.
  '/start/:commitmentId',
  // The workout runner (#109, epic E09). PRD §11 again: the runner replaces
  // the navigation while a workout is happening, and "replace" is achieved by
  // never mounting it rather than by a gate that remembers to turn it off.
  '/workout/:sessionId',
  // The comeback flow (#119, epic E11). PRD §57's three screens and the
  // celebration replace the navigation while somebody is restarting; there is
  // no rail and no bottom bar on them to highlight.
  '/comeback',
  '/comeback/done',
];

/**
 * A navigation destination, fully described for every surface that draws it.
 *
 * `permission` is the API permission that makes the destination REACHABLE, and
 * it is deliberately the same string the corresponding controller enforces —
 * see the comments on each entry. A destination with no `permission` and no
 * `anyPermission` is available to every authenticated user.
 */
export interface Destination {
  key: DestinationKey;
  /** Full label — the expanded rail, the bottom bar, the user menu. */
  label: string;
  /** Shown in the 56px collapsed rail, which will not hold "System Settings". */
  compactLabel: string;
  Icon: SvgIconComponent;
  path: string;
  /** API permission required to reach it; absent means "any authenticated user". */
  permission?: string;
  /**
   * Reachable when the user holds ANY ONE of these permissions.
   *
   * Added by #92 for `console`, which fronts pages from two different
   * controllers: someone with `users:read` alone must reach the Users &
   * Allowlist page, and someone with `system_settings:read` alone must reach
   * the settings pages. Neither may be dropped, and the single-string
   * `permission` field cannot express "or".
   *
   * Widening `permission` to `string | string[]` was the alternative and was
   * rejected: an array there reads as ALL by every convention in this codebase
   * (`hasAllPermissions`), so the same field would have meant "and" at one call
   * site and "or" at another. A separate field names the semantics.
   *
   * The two fields AND together when both are set — `permission` must be held
   * AND at least one of `anyPermission`. No destination sets both today; the
   * rule is stated so the day one does, `isDestinationVisible` is the only
   * place that has to know.
   */
  anyPermission?: readonly string[];
  /**
   * Render this destination pinned at the FOOT of the navigation rail, below a
   * divider, rather than inline in the destination list (#105).
   *
   * `console` is the only one today, and the flag exists so the rail never has
   * to spell `key === 'console'` in its render. A magic key there would be a
   * second, invisible answer to "what is the admin surface" — the exact
   * split-brain this file's header describes — and it would silently stop
   * being true the day the admin destination is renamed or a second mode is
   * added. Declaring it here keeps ONE place that knows Console is a MODE and
   * not a peer of the library destinations, which is what its position at the
   * foot communicates.
   *
   * THE BOTTOM BAR OMITS PINNED DESTINATIONS ENTIRELY (#51), rather than
   * pinning them — it has no foot to pin to, because it IS the foot. Material 3
   * caps a bottom bar at five destinations and the five product destinations
   * fill it exactly; a sixth tab would force a choice between labels and fit.
   * An admin on a phone reaches Console through the avatar menu instead, which
   * is a flat list and still renders every visible destination in declaration
   * order, pinned ones included. Ordering here therefore still has to be the
   * correct order for the menu.
   */
  pinned?: boolean;
}

/**
 * Is `destination` visible to a user with this `hasPermission` predicate?
 *
 * EVERY surface calls this rather than testing `destination.permission`
 * inline. Four surfaces (rail, bottom bar, user menu, quick actions) each ran
 * their own `!destination.permission || hasPermission(...)` expression, and
 * every one of them silently ignored `anyPermission` the moment it was added —
 * the `console` row would have appeared for everyone. One function is the same
 * fix this file's header describes for the paths themselves.
 */
export function isDestinationVisible(
  destination: Destination,
  hasPermission: (permission: string) => boolean,
): boolean {
  if (destination.permission && !hasPermission(destination.permission)) return false;
  if (destination.anyPermission && !destination.anyPermission.some(hasPermission)) return false;
  return true;
}

/**
 * The five product destinations plus Console, in navigation order.
 *
 * The five are PRD §11's primary navigation, in PRD §11's order, and that
 * order is deliberate rather than alphabetical: Today first because VISION
 * Part VII §27 calls it "the most important screen", Profile last because it
 * is the one you visit least.
 *
 * Declaration order IS navigation order on every surface. Two surfaces treat
 * the tail specially, both for `pinned` destinations only: the rail lifts them
 * to its foot (#105), and the bottom bar omits them entirely (#51).
 *
 * GATING IS BY PERMISSION, NOT BY ROLE, and the permission is the one the API
 * actually enforces — verified against the controllers rather than assumed:
 *
 *   - `users.controller.ts`           → `users:read`
 *   - `system-settings.controller.ts` → `system_settings:read`
 *
 * `console` is reachable on EITHER of those (see `anyPermission`), because
 * `/admin/settings` fronts pages from both controllers and a user entitled to
 * only one half must still reach the surface. The per-page gates inside
 * `/admin/settings/*` are what decide which cards and routes that user actually
 * gets — `config/adminSections.tsx` declares them, and `App.tsx` wraps each
 * route in the matching `RequirePermission`.
 *
 * That is the same REACHABILITY-vs-CONTENT split this file has always drawn:
 * the Users & Allowlist page gates on `users:read` to be reached, while its
 * Allowlist half gates itself on `allowlist:read` inside the page, because its
 * data comes from `allowlist.controller.ts`.
 *
 * `isAdmin` is no longer a navigation gate anywhere. It still exists (and
 * `AdminOnly` with it) for non-navigation uses, but a role check here is what
 * produced the split-brain described in the file header.
 */
export const DESTINATIONS: readonly Destination[] = [
  {
    key: 'today',
    label: 'Today',
    compactLabel: 'Today',
    Icon: TodayIcon,
    path: '/',
  },
  {
    key: 'path',
    label: 'Path',
    compactLabel: 'Path',
    Icon: RouteIcon,
    path: '/path',
  },
  {
    key: 'coach',
    label: 'Coach',
    compactLabel: 'Coach',
    Icon: ForumIcon,
    path: '/coach',
  },
  {
    key: 'progress',
    label: 'Progress',
    compactLabel: 'Progress',
    Icon: InsightsIcon,
    path: '/progress',
  },
  {
    key: 'profile',
    label: 'Profile',
    compactLabel: 'Profile',
    Icon: PersonIcon,
    path: '/settings',
  },
  {
    key: 'console',
    label: 'Console',
    compactLabel: 'Console',
    Icon: AdminIcon,
    path: '/admin/settings',
    anyPermission: ['system_settings:read', 'users:read'],
    // Pinned at the rail's foot (#105) and EXCLUDED FROM THE BOTTOM BAR (#51)
    // — a mode, not a sixth product destination. The permission gate above
    // still runs first: a user who cannot reach Console gets no pinned row AND
    // no stray divider.
    pinned: true,
  },
];

/**
 * Which destination, if any, owns `pathname`.
 *
 * Longest prefix wins where prefixes overlap. `/admin` is a single prefix
 * today, so nothing under it competes — but the rule is what keeps `/` from
 * winning everything (it is handled by `owns`' exact-match case) and what will
 * keep a future sibling prefix correct without touching this function.
 */
export function resolveActiveDestination(pathname: string): DestinationKey | null {
  let best: { key: DestinationKey; length: number } | null = null;

  for (const [key, prefixes] of Object.entries(DESTINATION_ROUTES) as [
    DestinationKey,
    readonly string[],
  ][]) {
    for (const prefix of prefixes) {
      if (!owns(prefix, pathname)) continue;
      if (!best || prefix.length > best.length) {
        best = { key, length: prefix.length };
      }
    }
  }

  return best?.key ?? null;
}
