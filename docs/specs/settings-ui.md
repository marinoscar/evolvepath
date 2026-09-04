# Settings UI Pattern

> **Status:** in force. The five rules in [CLAUDE.md → "MANDATORY: Settings UI
> Pattern"](../../CLAUDE.md#mandatory-settings-ui-pattern) are restated here
> verbatim, each followed by the reasoning CLAUDE.md deliberately leaves out.
> CLAUDE.md is the rule; this file is the argument. Section numbering is
> stable — CLAUDE.md links **§5** for the breakpoint gates.

---

## 1. Purpose and scope

This application has exactly two settings surfaces, and they are the same page
twice:

| Surface | Hub route | Registry | Binding |
|---|---|---|---|
| Admin (Console) | `/admin/settings` | `apps/web/src/config/adminSections.tsx` (`ADMIN_SECTIONS`) | `apps/web/src/pages/Admin/SettingsHubPage.tsx` |
| Per-user | `/settings` | `apps/web/src/config/userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`) | `apps/web/src/pages/UserSettingsHubPage.tsx` |

**"Registry-driven hub"** means: an array of section/card definitions is the
single declaration of what settings pages exist, who may reach them and what
they are called, and every surface that draws or resolves a settings page reads
that one array. Nothing derives its own list.

The pattern came from **epic #90** (issues #91–#96). Before it, the admin
surface was two tab-strip pages — `SystemSettingsPage` with three tabs, a user
management page with two — plus a *separate* list of rail destinations in
`config/destinations.ts`; three gates gave three answers, and a user could end
up with a reachable page, a menu entry pointing at it, and no rail row. Epic #90
replaced the tab strips with routed destinations behind one searchable hub, and
made the registry the only place any of the three consumers looks.

---

## 2. The five MANDATORY rules

### Rule 1 — Every new settings page MUST be declared in a section registry

> Admin cards go in `apps/web/src/config/adminSections.tsx` (`ADMIN_SECTIONS`);
> per-user cards go in `apps/web/src/config/userSettingsSections.tsx`
> (`USER_SETTINGS_SECTIONS`). A route added without a registry entry is not
> acceptable — it is a route the hub, the Console rail, and the AppBar title
> resolver all disagree about, because none of the three has any way to know it
> exists.

**Why.** The registry has three consumers, and none of them can discover a route
on its own:

1. `SettingsHub` — the card grid, and the phone drill-down list
2. `NavigationRail` in Console mode — the rail's contents on any `/admin/*` route
3. `AppBar` — resolving a route to the title shown in the compact drill-down header

A route with no card is not "a page the hub happens not to link". It is a page
the rail cannot list, the AppBar renders with the *hub's* title instead of its
own, and search cannot find. Declaring the card first makes all three correct by
construction, because there is one array and they all read it.

`apps/web/src/__tests__/config/destinations.test.ts` enforces this mechanically:
it reads `App.tsx`'s source and fails on any route that is neither claimed by a
registry nor listed as deliberately unowned.

### Rule 2 — A settings page MUST NOT be added as a new tab on an existing settings page

> Tabs remain legitimate **inside** a single destination, but only for genuinely
> **parallel** content — two views of the same question.

**The distinction, precisely:**

- A **destination** gate (which registry card, which route) is about
  **reachability**.
- A **tab** gate (inside one page) is about **content**.

**The legitimate example** is `apps/web/src/pages/Admin/UsersPage.tsx`, which
keeps its two tabs — Users, Allowlist — on purpose. They are two views of one
question ("who may use this application"), backed by two controllers
(`users.controller.ts`, `allowlist.controller.ts`), and neither is a parent of
the other. The card gates on `users:read` because the page is worth reaching for
its Users half alone; the Allowlist tab gates its own content on
`allowlist:read` *inside* the page. That is the reachability/content split doing
exactly what it is for.

**The anti-example** is `SystemSettingsPage`'s former three tabs — UI Settings,
Feature Flags, Advanced JSON. Those were **hierarchical content wearing a tab
strip**: "Advanced JSON" is a raw editor over the same document the other two
edit through typed controls, not a parallel view of it. They are now three
cards, three routes and three titles. Conflating a hierarchy with a set of
parallel views is the exact mistake epic #90 fixed.

**What a tab strip costs, concretely:** no per-section URL to link or bookmark,
no per-section title in the AppBar, no search entry, and — because tabs live
inside one page — no way for the rail to show where you are.

### Rule 3 — The card's `permission` field MUST be the exact string the API controller enforces

> …never invented, never approximated.

**Why.** This registry mirrors authorization; it does not define it. A card
gating on a string the API does not enforce is either a page a permitted user
cannot see or a page an unpermitted user can open and then fail inside. Gating
by **role** rather than permission is what produced the split-brain
`config/destinations.ts` describes in its own header.

The verified mapping, as of the AI configuration epic (#20):

| Permission string | Enforced by |
|---|---|
| `system_settings:read` / `system_settings:write` | `apps/api/src/settings/system-settings/system-settings.controller.ts` |
| `system_settings:read` / `system_settings:write` | `apps/api/src/email/email-settings.controller.ts` |
| `system_settings:read` / `system_settings:write` | `apps/api/src/ai/ai-settings.controller.ts` |
| `users:read` | `apps/api/src/users/users.controller.ts` |
| `allowlist:read` | `apps/api/src/allowlist/allowlist.controller.ts` — gates content **inside** the Users & Allowlist page, not the route (see rule 2) |

Two live consequences worth knowing before copying a card:

- **`Advanced (JSON)` gates on `system_settings:write`**, unlike its siblings.
  It is a raw editor over the whole settings document, so read-only access to it
  has no meaning: a user who cannot save has nothing to do there that the typed
  pages do not do better.
- **`Email` and `AI` gate on `system_settings:read`** even though saving and
  testing need `:write`. The card gate is about reachability, and a read-only
  administrator diagnosing "why is mail broken" or "why is the coach quiet" is
  worth letting in to look. The page disables its own controls with a stated
  reason.
- **Per-user cards declare no `permission` at all.** Every authenticated user
  owns their own settings, and the API grants `user_settings:*` to all three
  roles. Adding a gate there would invent a rule the API does not enforce —
  and would, for the `/settings/ai-key` card, leave a Viewer unable to supply
  the key without which they cannot use the application at all.

### Rule 4 — New settings surfaces MUST reuse the shared `SettingsHub` component

> Do not fork it, do not copy it.

**Why.** `apps/web/src/components/settings/SettingsHub.tsx` owns two responsive
treatments, a search field, an empty state and scroll restoration. A hub copied
from it is four places to fix every future bug, and two of the four are the ones
nobody remembers to check.

The worked example is `/settings`
(`apps/web/src/pages/UserSettingsHubPage.tsx`): a **4-prop binding**
(`sections`, `hubKey`, `title`, `subtitle`) over the exact same component
`/admin/settings` uses, and nothing more. Nothing in `SettingsHub.tsx` names
"admin", and nothing in it may.

### Rule 5 — The five coupled breakpoint gates move together or not at all

See **§5**.

---

## 3. Registry shapes

Both registries use the types and helpers declared in `adminSections.tsx`.
`userSettingsSections.tsx` declares **data only** and imports the rest — which is
precisely why the helpers take their inputs as parameters instead of closing over
the admin constants.

### `SettingsCardDef`

| Field | Type | Meaning |
|---|---|---|
| `title` | `string` | Card heading, rail row label, and the AppBar title for the route. |
| `description` | `string` | One sentence on the hub card. **Not** matched by search — see below. |
| `Icon` | `SvgIconComponent` | The icon **component**, never a rendered element. |
| `path` | `string?` | Route the card navigates to. Absent means "declared in the IA but not yet routed". |
| `disabled` | `boolean?` | Rendered, but inert — a page that exists in the IA but is not usable yet. |
| `permission` | `string?` | The API permission string. Absent means "any authenticated user". |
| `alwaysShow` | `boolean?` | Escape hatch: show the card even without `permission`. For pages that gate their own **content** internally and are still worth reaching. |

`Icon` is a component because the hub draws it at 40px and the rail at ~20px.
Storing `<AdminIcon />` would freeze the size at declaration time and make every
consumer clone the element to resize it.

### `SettingsSectionDef`

`{ label: string; cards: SettingsCardDef[] }` — an `overline` header on the hub,
a `ListSubheader` in the rail.

### `visibleSettingsSections(sections, hasPermission, query)`

Filters a registry to what the current user may see, optionally also applying the
"Search settings" filter, and **drops any section left empty**.

- **Title-only search**, case-insensitive. Matching descriptions too would mean
  a two-letter query surfacing eight cards because their prose shares a word — a
  worse result set than a strict title match, and one the user cannot predict.
- **Empty sections are dropped**, not rendered as a bare header: a group header
  above nothing reads as a loading failure rather than as "you may see none of
  these".
- **`alwaysShow` short-circuits the permission check** but not the search filter.
- Every consumer calls *this function*, not its own loop. That is what makes
  epic #90's success criterion — the hub, the rail and the title resolver never
  disagree — testable with a single assertion.

### `settingsPageTitle(sections, hubPath, hubTitle, pathname)`

Resolves a pathname to the human title of the page it renders, for the compact
drill-down AppBar.

- **Longest prefix wins**, so `/admin/settings/users/:id` resolves to
  "Users & Allowlist" rather than falling back to the hub title, and a future
  `/admin/settings/storage/insights` beats a `/admin/settings/storage` sibling
  instead of losing to whichever was declared first.
- **Segment boundaries are respected** (`path === pathname`, or `pathname`
  continuing with a `/`), so `/admin/settings/users` does not claim
  `/admin/settings/users-archive`. A bare `startsWith` is the bug
  `destinations.ts`'s `owns()` was written to kill.
- **Returns `null`** when the path is not under `hubPath` at all. That is a
  different answer from "this is the hub itself" (`hubTitle`), and collapsing
  the two would put a back arrow on every page in the app.

---

## 4. `SettingsHub` props

From `apps/web/src/components/settings/SettingsHub.tsx`:

| Prop | Meaning |
|---|---|
| `sections` | The registry to draw, passed **unfiltered** — both gates live in `visibleSettingsSections`, so a caller cannot accidentally apply its own. |
| `hubKey` | Stable scroll-restoration key, namespaced per surface (`'admin-settings-hub'`, `'user-settings-hub'`). The two hubs are different documents of different heights; a shared key would restore one page's offset onto the other. |
| `title` | The `h4`. Comes from the registry's own hub constant, because the AppBar's title resolver falls back to the same constant — a default baked into the component would be a second place deciding what a hub is called. |
| `subtitle` | The `body1` secondary line. Surface-specific prose. |

**What the component owns:** the search field, the grouped card grid at and
above `sm`, the iOS-style drill-down list below it, the empty state, and scroll
restoration keyed by `hubKey`. `useScrollRestoration` is called
**unconditionally**, before any early return — `isCompactWindow` flips on a
plain resize, and a hook called only in the compact branch would change hook
order mid-session and crash the tree.

---

## 5. Breakpoints — the five coupled gates

CLAUDE.md links here for this section.

| # | File | Expression | What it controls |
|---|---|---|---|
| 1 | `apps/web/src/components/common/Layout.tsx` | `showRail = useMediaQuery(theme.breakpoints.up('sm'))` | Mounts/unmounts `NavigationRail` |
| 2 | `apps/web/src/components/navigation/BottomNav.tsx` | `isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'))` | The bottom bar — the exact complement of (1) |
| 3 | `apps/web/src/components/common/Layout.tsx` | `<main>`'s `pb: { xs: 10, sm: 3 }` | Clears the fixed bottom bar, which exists only where (2) mounts it |
| 4 | `apps/web/src/components/settings/SettingsHub.tsx` | `isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'))` | Drill-down list below, card grid at and above |
| 5 | `apps/web/src/components/navigation/AppBar.tsx` | `isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'))` | Drill-down header with a back arrow, vs. the full toolbar |

### Why `sm` (600px) and never `md` (900px)

600px is Material 3's compact/medium boundary — compact below 600dp, medium
600–840dp — and M3 is explicit that a rail is the correct chrome from medium
upward. Gating at MUI's `md` (900px) hands the **phone treatment** to every
600–899px device: tablets in portrait (iPad 768px, iPad Pro 11" 834px), foldables
unfolded, and phones in landscape.

### What breaks when they drift

- (1) vs (2): a band of widths with **two** navigation surfaces, or **none**.
- (3) alone: 600–899px carries 80px of bottom padding for a bar that is not
  mounted there.
- (4) vs (5): exactly two broken screens — a back-arrow drill-down header sitting
  above a card grid, or a full wordmark toolbar above a drill-down list with no
  way back up.

(4) and (5) are tied to (1)–(3) as well, because "there is no rail here" is what
makes the hub itself the navigation below `sm`.

### Why there is deliberately no shared constant

A constant would let (3) drift while still compiling: `pb: { xs: 10, sm: 3 }` is
an `sx` object keyed by breakpoint name, not a media query, so it cannot consume
the same value the other four would share. Extracting a constant for the four
that *can* use it would create a false sense that the set is enforced, and would
invite new, unrelated things to be gated on it — at which point "these five move
together" stops being true because the set is no longer five. The comment in
`Layout.tsx` is the invariant's only enforcement, and it says so.

### What is *not* a sixth gate

A component-local `useMediaQuery(theme.breakpoints.down('sm'))` used for layout
**inside a single page** — a table that becomes a stack of cards, say, as the
AI settings page's persona/model table does (epic #20) — is a local layout
choice, not a navigation gate. It changes nothing about which chrome is mounted,
so it can move on its own. Say so in the component's header when you add one.

---

## 6. Rejected alternatives

**A tab strip per area.** Rejected: no per-section URL to link or bookmark, no
per-section AppBar title, no search entry, no rail row, and — because a tab strip
has no room to grow — a hard ceiling on how many settings a surface can hold
before the strip starts scrolling horizontally. This is the shape epic #90
removed; see rule 2 for the one case where tabs survive.

**An ungoverned route (page without a card).** Rejected: it is invisible to the
hub, the rail and the title resolver simultaneously, because all three read the
registry and none can discover a route. `destinations.test.ts` fails the build
for it.

**Role-based gating instead of permission strings.** Rejected: this is the
split-brain `config/destinations.ts` documents. Roles are a *grouping* of
permissions that the API can regroup at any time; a card gating on `admin`
silently breaks the day a permission is granted to Contributor.

**Gating at `md` (900px).** Rejected: see §5. It hands the phone treatment to
tablets, foldables and landscape phones.

**A second copy of the gate helpers for the user hub.** Rejected, and this is why
`visibleSettingsSections` and `settingsPageTitle` take `sections`, `hubPath` and
`hubTitle` as parameters instead of closing over the admin constants. Two copies
of the permission gate is the exact drift the registry exists to prevent; copying
them to serve the second surface would have reintroduced it on day one.

**A hub copied from the admin one.** Rejected for the same reason at the
component level — see rule 4.

---

## 7. Accessibility requirements

- **Hub cards are links with accessible names.** The card's `title` is the
  accessible name; the description is supplementary text, not part of the name.
- **The search field is a labelled `input`.** It has no visible `<label>` — a
  placeholder is not one, and it disappears the moment the user types, taking
  the only announced name with it — so `aria-label="Search settings"` is
  explicit. The clear button renders only when there is something to clear; a
  permanently mounted one is a dead tab stop that reads as an affordance doing
  nothing.
- **The drill-down list uses list semantics** (`List` / `ListItemButton`), so a
  screen reader announces position and count.
- **The AppBar back arrow has an `aria-label`.**
- **Page titles come from the registry**, so the AppBar title and the page's own
  heading cannot disagree.
- **`axe` runs in the page tests.** A new settings page's test file is expected
  to assert no violations at both a desktop and a phone width — the two widths
  are different component trees (§5), so one clean run does not imply the other.

---

## 8. Testing

| File | What it holds the line on |
|---|---|
| `apps/web/src/__tests__/config/settingsRegistry.test.ts` | Registry shape, permission strings, and that the gate helpers agree across consumers |
| `apps/web/src/__tests__/config/userSettingsSections.test.ts` | The per-user registry and `settingsPageTitle` over `/settings` |
| `apps/web/src/__tests__/config/destinations.test.ts` | **The route-ownership invariant**: reads `App.tsx`'s source and fails on any route neither claimed by a registry nor listed as deliberately unowned |
| `apps/web/src/__tests__/components/settings/SettingsHub.test.tsx` | Both responsive treatments, search, empty state, scroll restoration |

**Visual regression** lives in `tests/visual/`, driven by the harness at
`apps/web/visual/main.tsx`, which mounts the real routes with a faked
`AuthContext`. Baselines are regenerated **only** inside the pinned container
`mcr.microsoft.com/playwright:v1.62.1-noble` (`cd tests/visual && npm run
test:update`) — font rasterisation differs between hosts, so a baseline captured
anywhere else is noise. Adding a card changes the hub grid, so
`admin-hub.spec.ts-snapshots/` or `user-hub.spec.ts-snapshots/` will need
regenerating even when the new page has no capture of its own.

---

## 9. Adding a settings page — checklist

1. **Card first.** Add a `SettingsCardDef` to the right registry, in the right
   group, with the `permission` string the controller actually enforces (rule 3).
   Not the route, not the page — the card.
2. **Route.** Add it to `App.tsx`, lazily, next to its siblings. Admin routes
   wrap in `RequirePermission` with the same string as the card.
3. **Page.** Build it. Reuse `SettingsHub` if it is a hub (rule 4); use
   `UserSettingsSection` for per-user page chrome. Do not add a tab (rule 2), and
   do not touch any of the five gates (§5).
4. **Harness.** Add the route to `apps/web/visual/main.tsx`, so the hub card
   navigates there in the visual harness too.
5. **Tests.** Page test with `axe` at a desktop and a phone width; add the route
   to `destinations.test.ts`'s owned list; assert the card's permission in the
   registry test.
6. **Visual baselines.** Regenerate the affected hub snapshot inside the pinned
   container.
7. **Docs.** Update `docs/API.md` for the endpoints and CLAUDE.md if the surface
   introduces a new pattern.

**The worked examples**, added by epic #20: the admin **AI** card
(`/admin/settings/ai`, `system_settings:read`) and the per-user **OpenAI API
Key** card (`/settings/ai-key`, no permission).
