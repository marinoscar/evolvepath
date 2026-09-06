/**
 * The per-user settings information architecture — the same registry shape as
 * `adminSections.tsx`, for the `/settings` surface.
 *
 * Issue #91, epic #90. `/settings` is today one page stacking three cards
 * (Theme, Profile, Personal Access Tokens). Epic #90 splits it into routed
 * destinations behind the same searchable hub the admin console gets (#96), so
 * it needs the same thing the console needs: ONE declaration read by the hub,
 * the AppBar's title resolver, and anything else that later wants to draw the
 * surface.
 *
 * This file deliberately declares only DATA. The `SettingsCardDef` /
 * `SettingsSectionDef` types and both helpers
 * (`visibleSettingsSections`, `settingsPageTitle`) are imported from
 * `adminSections.tsx` and re-used verbatim — which is precisely why those
 * helpers take `sections`, `hubPath` and `hubTitle` as parameters instead of
 * closing over the admin constants. Two copies of the permission gate is the
 * drift the registry exists to prevent, and copying it here to serve a second
 * surface would reintroduce it on day one.
 */

import PersonIcon from '@mui/icons-material/Person';
import PaletteIcon from '@mui/icons-material/Palette';
import NotificationsIcon from '@mui/icons-material/Notifications';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import KeyIcon from '@mui/icons-material/Key';
import PsychologyIcon from '@mui/icons-material/Psychology';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import type { SettingsSectionDef } from './adminSections';

/**
 * The user settings sections, in hub order.
 *
 * NO CARD DECLARES A `permission`, and that is the correct model rather than
 * an omission: every authenticated user owns their own settings, and the API
 * grants `user_settings:read` / `user_settings:write` to all three roles
 * (Admin, Contributor, Viewer). Adding a gate here would be inventing an
 * authorization rule the API does not enforce — the opposite of what this
 * registry is for. `visibleSettingsSections` is still the function the hub
 * calls, so search filtering and empty-section collapsing behave identically
 * to the admin surface; the permission half of the gate simply passes
 * everything through.
 *
 * Access Tokens sits under its own `Security` group rather than under
 * `Account` because a PAT is a long-lived credential: grouping it with display
 * name and theme would put "create a bearer token that outlives your session"
 * one row below "pick a colour scheme".
 */
export const USER_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Account',
    cards: [
      {
        title: 'Profile',
        description: 'Your display name and profile image, and the email you signed in with.',
        Icon: PersonIcon,
        path: '/settings/profile',
      },
      {
        title: 'Appearance',
        description: 'Choose a light, dark, or system-matched theme for this account.',
        Icon: PaletteIcon,
        path: '/settings/appearance',
      },
      {
        // Issue #126, epic #109. NO `permission`, like every card here: the
        // page edits the caller's OWN preferences through
        // `PATCH /api/user-settings`, which the API grants to all three roles,
        // and the registry it renders (`GET /api/notifications/events`) is
        // `@Auth()` with no permissions for exactly that reason — gating this
        // card would leave a Viewer unable to say how they are contacted.
        //
        // Under `Account` rather than `Security`, even though one of the events
        // it lists is a security alert: the card is about how this account is
        // contacted, not about credentials. `Security` holds long-lived
        // credentials (see the group's own note below).
        title: 'Notifications',
        description:
          'Choose which events notify you, and whether they arrive by email or in your browser.',
        Icon: NotificationsIcon,
        path: '/settings/notifications',
      },
      {
        // Epic E10 (#84). No `permission`, like every card here: the review
        // rhythm is two columns on the caller's OWN `user_profiles` row, and
        // `PUT /api/weekly/settings` is plain `@Auth()` for exactly that
        // reason — gating it would leave a Viewer unable to choose when their
        // own week is reviewed.
        title: 'Weekly rhythm',
        description: 'Choose the day and time your weekly review is prepared.',
        Icon: EventRepeatIcon,
        path: '/settings/weekly-rhythm',
      },
    ],
  },
  {
    // Epic #20. Its OWN group rather than a fourth card under `Account`,
    // because it is not a preference: without a key the application does not
    // work at all, and burying "the credential that powers everything" between
    // a display name and a colour scheme misstates what it is. It sits above
    // `Security` because it is something every user must do, where a personal
    // access token is something most never will.
    //
    // NO `permission`, like every card here: a Viewer must be able to supply a
    // key, since without one they cannot use the app.
    label: 'AI',
    cards: [
      {
        title: 'OpenAI API Key',
        description:
          'Add, test or remove the OpenAI API key that powers your coaching.',
        Icon: KeyIcon,
        path: '/settings/ai-key',
      },
      {
        // No `permission`: an insight is the caller's own row, and the
        // controller enforces that with a 404 rather than a role.
        title: 'AI Memory',
        description:
          'See what the coach has learned about you. Confirm, edit, forget, or exclude anything from coaching.',
        Icon: PsychologyIcon,
        path: '/settings/ai-memory',
      },
    ],
  },
  {
    label: 'Security',
    cards: [
      {
        title: 'Access Tokens',
        description: 'Create and revoke personal access tokens for API and CLI access.',
        Icon: VpnKeyIcon,
        path: '/settings/tokens',
      },
    ],
  },
  {
    // Issue #224, epic #220. Its OWN group, last, rather than a third card
    // under `Security`: that group is for long-lived CREDENTIALS — a personal
    // access token, and by adjacency the API key above it — and what a reset
    // erases is the user's data, not a way of proving who they are. Their
    // sign-in, their identity and their roles all survive it. Grouping the two
    // would say the opposite, and it would put "erase everything you have
    // built" one row below "create a bearer token".
    //
    // A REGISTRY CARD PLUS A ROUTE, never a tab on `/settings/profile` or
    // `/settings/ai-key`. CLAUDE.md's Settings UI Pattern rule 2 draws the
    // line precisely: a destination gate is about REACHABILITY and a tab gate
    // is about CONTENT. This is a destination — a place you go on purpose,
    // that the hub, the Console rail and the AppBar title resolver all have to
    // know exists — not a second view of the question either of those pages
    // answers.
    //
    // NO `permission`, like every card here: `POST /api/account/reset` is
    // `@Auth()` with no permissions and accepts no user id, because every
    // authenticated user owns their own data. A gate here would invent an
    // authorization rule the API does not enforce.
    label: 'Danger zone',
    cards: [
      {
        title: 'Reset your data',
        description:
          'Erase everything you have built in EvolvePath — outcomes, plans, commitments, evidence and coach history. This cannot be undone.',
        Icon: DeleteForeverIcon,
        path: '/settings/reset',
      },
    ],
  },
];

/**
 * The user settings hub — the one `/settings` route that owns no card.
 *
 * `USER_HUB_TITLE` is intentionally the same string as `ADMIN_HUB_TITLE`
 * ('Settings'): the two surfaces are never on screen at once, the path
 * disambiguates them for the title resolver, and calling this one "My
 * Settings" in the AppBar would be the only place in the app that names it
 * that way.
 */
export const USER_HUB_PATH = '/settings';
export const USER_HUB_TITLE = 'Settings';
