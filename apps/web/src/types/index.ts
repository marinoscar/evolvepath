export interface Role {
  name: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: Role[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
  /**
   * Whether this user has stored an OpenAI API key (epic #20).
   *
   * REQUIRED, not optional, and that is deliberate. `RequireAiKey` (#29) gates
   * the entire app shell on `user.aiKey.configured`, so an optional field would
   * make "the server did not send it" indistinguishable from "no key", and every
   * consumer would need an `?.` whose fallback silently decided a security-shaped
   * question. Making it required lets the compiler enumerate every fixture that
   * has to declare it.
   *
   * It rides on `GET /auth/me`, which the app already fetches on boot, rather
   * than on a second request — otherwise the gate is a waterfall in front of
   * every page load, and the visual harness (which fakes `AuthContext`
   * wholesale) would need a second fake to render anything.
   */
  aiKey: AiKeySummary;
  /**
   * Whether this user has finished onboarding (epic E04, #100).
   *
   * REQUIRED for the same reason `aiKey` is: the shell decides between the
   * onboarding flow and the app before it renders anything, and an optional
   * field would make "the server did not send it" look like "not onboarded".
   * Making it required lets the compiler list every fixture that must declare
   * it.
   */
  onboarding: OnboardingStatus;
}

/** Onboarding progress as `GET /auth/me` reports it. */
export interface OnboardingStatus {
  completed: boolean;
}

/**
 * The masked view of a user's stored OpenAI key.
 *
 * `hint` is the credential store's own mask (`••••` plus at most the last four
 * characters). The key itself is never returned by any endpoint.
 */
export interface AiKeySummary {
  configured: boolean;
  hint: string | null;
}

export type DataTableDensity = 'compact' | 'standard' | 'comfortable';

/**
 * Navigation preferences. Every field is optional and an ABSENT field means
 * "use the built-in default" — absence is meaningful, not incidental, so never
 * backfill these with literal defaults when reading settings.
 */
export interface NavigationSettings {
  railCollapsed?: boolean;
}

/**
 * Per-table preferences, keyed by table id. As with navigation, every field is
 * optional and an ABSENT field means "use the built-in default" for that table
 * (an absent `visibleColumns` is not an empty column set).
 */
export interface DataTableSettings {
  visibleColumns?: string[];
  density?: DataTableDensity;
  sort?: { field: string; direction: 'asc' | 'desc' };
  pageSize?: number;
}

// =============================================================================
// Notifications — the registry (#124) and the stored preferences (#126, epic #109)
// =============================================================================
//
// TWO DIFFERENT SHAPES THAT ARE EASY TO CONFUSE, so they are named apart here:
//
//   * `NotificationEventDef`  — what events EXIST. Static, identical for every
//     caller, served by `GET /api/notifications/events`. The server owns it;
//     the web app never declares its own copy (see the long argument in
//     `apps/api/src/notifications/notification-events.ts`).
//   * `NotificationPreferences` — what THIS user chose, stored inside the
//     user-settings document under `notifications`.
//
// A definition is not a preference: an account with no stored preferences is
// not "no events", it is every event at its registry default.
// =============================================================================

/**
 * A delivery channel.
 *
 * Mirrors the API's `NOTIFICATION_CHANNELS`. This union is the ONE piece of the
 * registry the web app restates, and only because it is the key type of the
 * patch documents below — an open `string` there would let a typo compile.
 * It is a closed set server-side too (the PATCH schema validates the outer key
 * against the same enum and 400s on anything else), so a channel this union
 * lacks is a channel this app could not write anyway.
 *
 * Rendering is nonetheless written to survive a NEWER server that declares a
 * channel this build has never heard of — see `CHANNEL_META` in
 * `components/settings/NotificationSettings.tsx`, which falls back to the raw
 * key rather than rendering a blank label.
 */
export type NotificationChannel = 'email' | 'browser' | 'push';

/**
 * What this browser can do about push, right now (#64, epic E12).
 *
 * FIVE STATES, not a boolean, because each of the three "no" cases needs a
 * different sentence and only one of them is the user's to fix:
 *
 *   `unsupported`  — no `PushManager` (an old browser, or a desktop Safari
 *                    before 16.4). Nothing anybody can do here.
 *   `unconfigured` — the SERVER has no VAPID keys. The user cannot fix this and
 *                    should not be told to try; an operator can.
 *   `denied`       — the user blocked notifications for this site. Recoverable,
 *                    but only in browser settings — this app cannot re-prompt.
 *   `unsubscribed` — everything is ready and they simply have not turned it on.
 *   `subscribed`   — on.
 *
 * Collapsing these to `canSubscribe: boolean` is exactly how a settings page
 * ends up saying "turn this on" to somebody for whom it cannot be turned on.
 */
export type PushState =
  | 'unsupported'
  | 'unconfigured'
  | 'denied'
  | 'unsubscribed'
  | 'subscribed';

/**
 * One device, as the API is willing to describe it.
 *
 * `endpointHost`, never the endpoint — a full push endpoint is a bearer
 * capability for that device.
 */
export interface PushSubscriptionSummary {
  id: string;
  endpointHost: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * One entry of the event registry, as served by `GET /api/notifications/events`.
 *
 * Field for field the API's `notificationEventSchema`. Note `mandatory` is a
 * plain `boolean` here, not `boolean | undefined`: the API normalises it on the
 * way out precisely so no client has to know that absent means "the user is in
 * charge".
 */
export interface NotificationEventDef {
  /** Stable key. What a preference is stored against; renaming one server-side is a migration. */
  key: string;
  /** Short human label — the row heading on the preferences page. */
  label: string;
  /** One sentence on what actually triggers this, in the user's terms. */
  description: string;
  /**
   * Channels this event CAN be delivered over — a capability of the event, not
   * a statement about which transports are implemented yet. A cell is rendered
   * only for a channel listed here, so `allowlist.invitation` (email only, its
   * recipient has no session by definition) never offers a browser toggle.
   */
  channels: NotificationChannel[];
  /** What an account that has expressed no preference receives. */
  defaultEnabled: boolean;
  /**
   * The user may not opt out, on ANY channel.
   *
   * A UI HINT ONLY — the gate is server-side in preference resolution, because
   * a client-side check is bypassed by any request that never went near the
   * client. Render the controls disabled WITH the reason rather than hiding
   * them: a dead toggle teaches nothing (epic #109, success criterion 5).
   */
  mandatory: boolean;
}

/**
 * One channel's stored preferences: event key -> the user's explicit choice.
 *
 * SPARSE. A key is present only where the user deliberately chose something. An
 * absent key is NOT `false` and must never be normalised into one — absent
 * means "use the registry's `defaultEnabled`", resolved at read time.
 */
export type NotificationChannelPreferences = Record<string, boolean>;

/**
 * The `notifications` namespace of the user-settings document, as stored.
 *
 * CHANNEL-OUTER, EVENT-INNER — `{ email: { 'user.welcome': false } }`. Not a
 * choice this file makes: it is the shape the API's
 * `readNotificationPreferences` parses and `isChannelEnabled` resolves, and a
 * document written event-outer would be silently ignored by the dispatcher,
 * i.e. a mute that never takes effect.
 *
 * Every level is optional, all the way down. There is deliberately no shape of
 * this value that asserts "the user has an opinion about every event".
 */
export type NotificationPreferences = Partial<
  Record<NotificationChannel, NotificationChannelPreferences>
>;

/**
 * PATCH form of one channel's preferences.
 *
 * The value is nullable because JSON Merge Patch uses `null` to mean DELETE:
 * `{ email: { 'user.welcome': null } }` removes that one event key, restoring
 * the absent (= registry default) state. That is what the preferences page
 * sends when a control returns to its default — writing the default value
 * explicitly works today and pins the user to today's default forever.
 */
export type NotificationChannelPreferencesPatch = Record<string, boolean | null>;

/**
 * PATCH form of the `notifications` namespace. Three levels of delete, each
 * meaning something different (see `UserSettingsUpdate`).
 *
 * Unlike `dataTables`, a non-null channel object is DEEP-merged per event
 * rather than replacing the channel wholesale — which is exactly what lets the
 * page send one key per toggle and leave every other preference absent.
 */
export type NotificationPreferencesPatch = Partial<
  Record<NotificationChannel, NotificationChannelPreferencesPatch | null>
>;

// =============================================================================
// The notification centre — delivered notifications (#127, epic #109)
// =============================================================================
//
// A THIRD notification shape, and the one most easily confused with the two
// above, so: `NotificationEventDef` is what CAN happen, `NotificationPreferences`
// is what the user WANTS, and `AppNotification` below is something that
// ACTUALLY HAPPENED — one row of the `notifications` table, addressed to this
// user, with its own read state.
//
// NAMED `AppNotification`, NOT `Notification`. The DOM declares a global
// `Notification` (the constructor behind the native toast), and this file's
// types are imported into modules that use BOTH — `services/browserNotifications.ts`
// raises a real `new Notification(...)` from one of these rows. A local
// interface called `Notification` would shadow the global inside every one of
// those modules, so the toast would silently be constructed from the wrong
// thing or fail to compile in a confusing place. The prefix costs one word and
// removes the collision entirely.
// =============================================================================

/**
 * One delivered notification, field for field the API's `notificationSchema`
 * (`apps/api/src/notifications/dto/notification.dto.ts`).
 *
 * THE SAME SHAPE ARRIVES TWO WAYS — fetched from `GET /api/notifications`, or
 * pushed over SSE — and that is deliberate on the API's side: a streamed event
 * is this object minus `readAt`, so both go into the same list with no second
 * mapping. See `streamEventToNotification` in `services/notificationStream.ts`,
 * which is the only place the missing field is filled in.
 */
/**
 * What one notification button does, mirroring the API's
 * `NOTIFICATION_ACTION_KEYS` (#54). Hand-maintained, like the rest of this
 * file — see the header on the EvolvePath types below for why.
 */
export type NotificationActionKey = 'start' | 'in' | 'move' | 'short' | 'skip';

/** What a recorded interaction says happened (#68, epic E12). */
export type NotificationInteractionKind = 'OPENED' | 'ACTIONED' | 'DISMISSED';

export interface NotificationInteractionInput {
  /** The `?n=` a deep link carries. */
  sentInteractionId?: string;
  /** The inbox row id, which the bell has instead. */
  notificationId?: string;
  kind: NotificationInteractionKind;
  /** Required when `kind` is `ACTIONED`, meaningless otherwise. */
  action?: NotificationActionKey;
}

/**
 * The coaching policy, as `/settings/notifications` renders it (#68).
 *
 * `fatigue` is REPORTED, not settable: it is the automatic reduction of PRD §61,
 * and the page shows it so a lower-than-configured cap reads as a deliberate
 * behaviour rather than as a bug.
 */
export interface NotificationPolicy {
  timezone: string;
  quietHours: { start: string; end: string } | null;
  dailyCap: number;
  weeklyCap: number;
  perCommitmentMax: number;
  mutedCategories: string[];
  fatigue: { active: boolean; effectiveDailyCap: number };
}

export interface NotificationPolicyPatch {
  quietHours?: { start: string; end: string } | null;
  dailyCap?: number;
  weeklyCap?: number;
  perCommitmentMax?: number;
  mutedCategories?: string[];
}

export interface NotificationAction {
  action: NotificationActionKey;
  /** PRD §63's vocabulary, rendered verbatim: "I'm in", "Skip today". */
  label: string;
  /** Root-relative, same guarantee as `AppNotification.link`. */
  link: string;
}

export interface AppNotification {
  id: string;
  /**
   * The registry key that raised this (`security.role_changed`).
   *
   * For grouping, icons or filtering. NOT what is rendered — `title` and `body`
   * were rendered server-side at write time, so editing a template never
   * rewrites what a user was already told.
   */
  eventKey: string;
  /** One short line. Already length-capped by the API. Render as TEXT. */
  title: string;
  /** The detail. Plain text, never markup. */
  body: string;
  /**
   * Root-relative path to open, or `null`.
   *
   * GUARANTEED INTERNAL by the API — `sanitizeLink` validated it before the row
   * was written, so it is always a single leading `/` with no scheme and no
   * protocol-relative `//`. That is what makes it safe to hand to
   * `navigate()`. The client still refuses anything that does not start with a
   * single `/` (see `isInternalLink` in `NotificationBell.tsx`): the guarantee
   * is the server's to keep, and a client that also checks costs one comparison
   * and survives the day it is broken.
   */
  link: string | null;
  /**
   * The buttons this notification offers (#54, epic E12).
   *
   * ALWAYS PRESENT, `[]` for the foundation events, so a renderer never has to
   * distinguish "no actions" from "an older server". Each `link` carries the
   * same root-relative guarantee as `link` above, and `action` names what the
   * button does so the client can record an ACTIONED interaction without
   * parsing the URL it is about to navigate to.
   */
  actions: NotificationAction[];
  /** ISO-8601. When the user marked it read; `null` while unread. */
  readAt: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/**
 * A page of `GET /api/notifications`.
 *
 * FLAT pagination (`items`/`total`/`page`/`pageSize`/`totalPages`), matching
 * `/users` and `/allowlist` rather than storage's nested `pagination` object —
 * the API deliberately picked the more common of its two existing list shapes.
 */
export interface NotificationListResponse {
  items: AppNotification[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * The badge number.
 *
 * Returned by `GET /api/notifications/unread-count` AND by BOTH mark-read
 * endpoints — which is why marking one read costs a single round trip: the
 * client already holds the row it marked, and the count is the only thing it
 * cannot compute for itself. Do not follow a mark-read with a count fetch.
 */
export interface UnreadCountResponse {
  unreadCount: number;
}

/**
 * One `event: notification` frame's payload, as `NotificationStreamService`
 * publishes it.
 *
 * `AppNotification` WITHOUT `readAt` — not an oversight and not a different
 * model: a notification is unread by definition at the instant it is
 * published, so the field would carry no information. Everything else is
 * identical, which is the property that lets a streamed event be pushed
 * straight into the fetched list.
 *
 * Carries NO user id. The recipient is implicit in which stream it arrived on;
 * the API omits it specifically so no client is ever tempted to filter on it.
 */
export type NotificationStreamEvent = Omit<AppNotification, 'readAt'>;

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  navigation?: NavigationSettings;
  dataTables?: Record<string, DataTableSettings>;
  /**
   * Per-channel, per-event notification preferences (#126, epic #109).
   *
   * OPTIONAL, AND ABSENT IS THE NORMAL CASE — not a loading state and not
   * "notifications off". No account has this key until it deliberately changes
   * a preference, so `settings.notifications ?? {}` resolves every event to its
   * registry default. Never backfill it with a materialised object.
   */
  notifications?: NotificationPreferences;
  updatedAt: string;
  version: number;
}

/**
 * PATCH form of `navigation`: each field may additionally be `null`, meaning
 * "delete this field and fall back to the built-in default".
 */
export type NavigationSettingsPatch = {
  [K in keyof NavigationSettings]?: NavigationSettings[K] | null;
};

/**
 * PATCH form of `dataTables`: the per-table VALUE may be `null` to delete that
 * table's entry. Note the asymmetry with navigation — a non-null entry REPLACES
 * the stored entry wholesale rather than being deep-merged, so its fields are
 * plain optionals and are NOT individually nullable. The server rejects
 * `{ [id]: { sort: null } }`; omit the field or replace the whole entry.
 */
export type DataTablesPatch = Record<string, DataTableSettings | null>;

/**
 * Payload accepted by `PATCH /api/user-settings`.
 *
 * This deliberately is NOT `Partial<UserSettings>`: the endpoint uses JSON
 * Merge Patch semantics, where `null` is a DELETE signal rather than a value.
 *   - `{ navigation: null }`                    clears the whole namespace
 *   - `{ navigation: { railCollapsed: null } }` deletes just that field
 *   - `{ dataTables: null }`                    clears the whole namespace
 *   - `{ dataTables: { [id]: null } }`          deletes just that table's entry
 *   - `{ notifications: null }`                 clears the whole namespace
 *   - `{ notifications: { email: null } }`      clears one channel
 *   - `{ notifications: { email: { k: null } }}` deletes ONE event key, restoring
 *                                               the registry default for it
 * Omitting a key leaves the stored value untouched. Server-owned fields
 * (`updatedAt`, `version`) are not patchable and so are absent here.
 */
export interface UserSettingsUpdate {
  theme?: UserSettings['theme'];
  profile?: Partial<UserSettings['profile']>;
  navigation?: NavigationSettingsPatch | null;
  dataTables?: DataTablesPatch | null;
  /**
   * Notification preferences (#126). The channel object is DEEP-merged per
   * event key server-side, which is what allows the preferences page to send
   * exactly the one key it changed and leave every other preference absent.
   */
  notifications?: NotificationPreferencesPatch | null;
}

export interface SystemSettings {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: Record<string, boolean>;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

export interface AuthProvider {
  name: string;
  authUrl: string;
}

export interface AllowedEmailEntry {
  id: string;
  email: string;
  addedBy: { id: string; email: string } | null;
  addedAt: string;
  claimedBy: { id: string; email: string } | null;
  claimedAt: string | null;
  notes: string | null;
}

export interface AllowlistResponse {
  items: AllowedEmailEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string | null;
  providerDisplayName: string | null;
  profileImageUrl: string | null;
  providerProfileImageUrl?: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UsersResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * What `GET /api/auth/device/activate?code=…` returns for a pending code.
 *
 * EVERY FIELD UNDER `clientInfo` IS ATTACKER-CHOSEN. `POST /auth/device/code`
 * is `@Public()`, its body is stored verbatim in the `device_codes.client_info`
 * JSONB column, and this endpoint hands that column back wholesale. The types
 * below describe what a WELL-BEHAVED client sends, not what will arrive — see
 * `components/device-activation/credential.ts`, which is the only place this
 * object is allowed to be interpreted.
 */
export interface DeviceActivationInfo {
  userCode: string;
  // Optional because the API declares it optional (`clientInfo?` on
  // DeviceActivateResponseDto) and because a row written by hand or by an older
  // build can carry `null`. It was typed as required, which let call sites do
  // `deviceInfo.clientInfo.deviceName` and crash the whole activation page on a
  // shape the server is allowed to send.
  clientInfo?: {
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
    // `string`, NOT the `'session' | 'pat'` union (#141). Two reasons, both
    // load-bearing: rows created before #141 have no `tokenType` at all, and
    // the column is not re-validated on read, so an unexpected value is a
    // shape we must be able to represent in order to defend against it. Typing
    // it as the union here would make `readCredentialKind`'s unknown-value
    // branch look like dead code and invite someone to delete it.
    tokenType?: string;
  };
  expiresAt: string;
}

export interface DeviceAuthorizationResponse {
  success: boolean;
  message: string;
}

// Personal Access Tokens
export type PatDurationUnit = 'minutes' | 'days' | 'months';

export interface PersonalAccessToken {
  id: string;
  name: string;
  tokenPrefix: string;
  durationValue: number;
  durationUnit: PatDurationUnit;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface PatCreatedResponse {
  token: string;
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Email settings — issue #124, epic #109.
//
// These mirror the payloads of `/api/email-settings`, which are NOT part of the
// system settings document: email is its own controller writing its own
// `system_settings` row, with its own version counter and its own save
// semantics (see `EmailSettingsInput` below), so it gets its own types rather
// than another branch of `SystemSettings`. Everything the web app knows about
// the wire format lives here and in `services/api.ts`'s email block — if the
// API's field names move, those two files are the whole reconciliation.
//
// THE SHAPE IS FLAT, because the API's is. `emailSettingsSchema`
// (`apps/api/src/email/email-settings.schema.ts`) is one object whose
// `sesRegion` / `smtpHost` / `smtpPort` / `smtpUsername` are siblings of
// `fromAddress` and `provider`, and both DTOs derive from it rather than
// restating it. An earlier draft of this file grouped them into `ses: {…}` and
// `smtp: {…}` sub-objects. That typechecked perfectly and was wrong on the
// wire in both directions: every read came back `undefined`, and every write
// was dropped by zod, which strips unknown keys. Do not re-nest — the types
// here are not free to be tidier than the payload they describe.
// ---------------------------------------------------------------------------

/**
 * Which transport sends mail. Mirrors `EMAIL_PROVIDER_KINDS` in the API's
 * `email-settings.schema.ts`.
 *
 * There is deliberately no `'disabled'` member. "Off" is not a transport, it is
 * `EmailSettings.enabled === false` — see the note there. The absence of a
 * chosen transport is `provider: null`, which is why every use of this type on
 * the wire is written `EmailProviderKind | null` rather than made optional.
 */
export type EmailProviderKind = 'ses' | 'smtp';

/**
 * What the API will tell us about the stored SMTP password — which is
 * everything except the password.
 *
 * The password itself is written into the encrypted credential store (epic
 * #108) and is unreadable through the API by construction: the response DTO
 * carries a compile-time proof that it has no field able to hold one. This
 * status object is what makes the blank password box honest; without it the UI
 * would render an empty field with no way to say whether submitting it keeps
 * something or keeps nothing.
 */
export interface SmtpPasswordStatus {
  /** Is a password stored at all? */
  configured: boolean;

  /**
   * The credential store's OWN mask — `••••` plus at most the last four
   * characters — derived once on write by the code that held the plaintext.
   *
   * Null when nothing is stored, and also null for a secret too short to mask
   * safely, so the UI must read correctly without it. Better than a fixed
   * placeholder: an admin who has just rotated a credential can see WHICH one
   * is live rather than only that one exists.
   */
  hint: string | null;

  /** When the stored password was last written. Null when nothing is stored. */
  updatedAt: string | null;

  /** Who last wrote it. Null when nothing is stored, or that user was deleted. */
  updatedByUserId: string | null;
}

/**
 * `GET /api/email-settings`, and the body of a successful `PUT`.
 *
 * The optional fields are optional in the same sense the API means: the key is
 * ABSENT when nothing is configured (`stripUnsetSettingFields` removes empty
 * values before the row is written), never present-and-empty. Read them with
 * `?? ''` and do not test them for `''`.
 */
export interface EmailSettings {
  /**
   * `null` means "no transport chosen", the state of every fresh install. It
   * is a persisted value, not a missing key.
   */
  provider: EmailProviderKind | null;

  /**
   * The master switch, a SEPARATE AXIS from `provider`. Nothing is sent while
   * this is false.
   *
   * Two fields rather than one because the pair carries something a single
   * three-way choice cannot: an admin who switches mail off for a maintenance
   * window keeps the transport and every field belonging to it, and turning it
   * back on costs no retyping. `provider: null, enabled: false` (never
   * configured) and `provider: 'smtp', enabled: false` (deliberately off) are
   * genuinely different states, and collapsing them would lose the second one.
   */
  enabled: boolean;

  /** SES region override, e.g. `us-east-1`. Absent means the deployment's `S3_REGION`. */
  sesRegion?: string;

  smtpHost?: string;
  smtpPort?: number;

  /**
   * REQUIRE TLS — not nodemailer's `secure` flag, which the API derives itself
   * from the port (465 is TLS from the first byte; everything else gets
   * required STARTTLS). Absent is treated as `true` by the provider, so the UI
   * must default it to on rather than to off.
   */
  smtpUseTls?: boolean;

  /** Absent means unauthenticated submission — a real configuration for an IP-authorised relay. */
  smtpUsername?: string;

  fromAddress?: string;
  fromName?: string;

  /** Everything the UI may know about the stored password. See {@link SmtpPasswordStatus}. */
  smtpPasswordStatus: SmtpPasswordStatus;

  /**
   * Why the STORED configuration could not be read, when it could not be. Null
   * on the normal path.
   *
   * The read endpoint degrades instead of throwing: a hand-edited row or a bad
   * migration would otherwise take down the one screen capable of repairing
   * it. When this is set, every settings field above is a DEFAULT rather than
   * the deployment's real configuration — which is why the page has to say so.
   * An admin who is not told is editing a form that does not describe their
   * system, and "saving" it overwrites the row they came to fix.
   *
   * Field paths only, never stored values.
   */
  settingsError: string | null;

  /** Bumped on every write. Pass back as `If-Match` on the next PUT. */
  version: number;

  updatedAt: string | null;
  updatedBy: { id: string; email: string } | null;
}

/**
 * A settings field an admin left empty.
 *
 * An HTML form cannot express "absent": a cleared text input submits `''` and a
 * reset controlled component submits `null`. The API's
 * `updateEmailSettingsSchema` wraps every optional field in a `blankable`
 * union that accepts both, and converts them to "absent" exactly once, in
 * `EmailSettingsService.update`. So the web app sends what the admin did —
 * they cleared the box — instead of reimplementing that conversion here and
 * getting a seventh copy of it slightly wrong.
 */
export type Blankable<T> = T | '' | null;

/**
 * `PUT /api/email-settings`.
 *
 * A full replacement, not a patch, plus the version the caller believed it was
 * replacing (sent as `If-Match` — see `updateEmailSettings` in
 * `services/api.ts`, not carried in this body).
 *
 * `provider` and `enabled` are REQUIRED and are NOT blankable: `null` is a real
 * persisted value for `provider`, so the API keeps it distinct from an emptied
 * box, and stripping it would drop a required key and fail the parse.
 *
 * BLANK PRESERVES (the #115 contract, restated by #124). `smtpPassword`
 * omitted — or sent as an empty string — leaves the stored password exactly as
 * it is; a non-empty value replaces it. There is deliberately NO way to erase a
 * password by clearing the field, because "I left the box alone" and "I want no
 * password" are the same gesture, and guessing wrong in the destructive
 * direction silently breaks mail for everyone. Note it is the ONE field this
 * app omits rather than sending as `''`: for every other field `''` means "not
 * configured", and for this one it means "unchanged".
 */
export interface EmailSettingsInput {
  provider: EmailProviderKind | null;
  enabled: boolean;
  sesRegion?: Blankable<string>;
  smtpHost?: Blankable<string>;
  smtpPort?: Blankable<number>;
  smtpUseTls?: Blankable<boolean>;
  smtpUsername?: Blankable<string>;
  fromAddress?: Blankable<string>;
  fromName?: Blankable<string>;
  smtpPassword?: string;
}

/**
 * `POST /api/email-settings/test` — the result of a real send attempt.
 *
 * A FAILED SEND IS A 200 WITH `success: false`, not a rejected promise: the
 * request succeeded, the mail did not. That is why the page branches on this
 * field and never on "did the call throw" — the single most likely way this
 * page could end up claiming success while the provider refused the message.
 *
 * Every field is present on a real response (nullable rather than optional in
 * the API's DTO). They are optional HERE because the hook also builds this
 * shape locally when the CALL itself fails — a 403, a 500, a dropped
 * connection — which is still a failed test and belongs in the same red
 * region, but has no recipient, no provider and no timestamp to report.
 */
export interface EmailTestResult {
  success: boolean;

  /**
   * Where it went — the caller's own address, taken from the session. Echoed
   * back so the UI states the destination as fact rather than assuming it.
   */
  sentTo?: string;

  /**
   * Which transport carried, or refused, the message. Null when nothing was
   * attempted because no provider was configured. Worth showing: an admin who
   * has just switched from SMTP to SES needs to know which one produced the
   * error in front of them.
   */
  providerKind?: EmailProviderKind | null;

  /** Provider message id on success — the string that correlates this attempt with a provider-side log. */
  messageId?: string | null;

  /**
   * The provider's VERBATIM error on failure — `535 Authentication failed`,
   * `MessageRejected: Email address is not verified`. Diagnosing mail
   * configuration is this page's entire job (#124), so this string is rendered
   * as-is and never replaced with a friendlier summary. Already redacted and
   * length-capped by the API's `SecretRedactor`.
   */
  error?: string | null;

  /** When the attempt was made. */
  attemptedAt?: string;
}

// =============================================================================
// AI provider configuration (epic #20)
// =============================================================================

/**
 * Providers this deployment can talk to.
 *
 * One entry, mirroring `AI_PROVIDER_KINDS` in
 * `apps/api/src/ai/ai-settings.schema.ts`. A second provider is explicitly out
 * of scope for epic #20; the union exists so adding one later widens every
 * `switch` in the same edit.
 */
export type AiProviderKind = 'openai';

/** How much reasoning a persona's work is worth paying for. A hint, not a rule. */
export type AiPersonaTier = 'fast' | 'reasoning';

/** What kinds of input a persona accepts. `vision` is a gate the API enforces. */
export type AiPersonaCapability = 'text' | 'vision';

/**
 * One row of the admin persona table, from `GET /api/ai-settings/personas`.
 *
 * FETCHED, NOT DECLARED HERE. The web app renders the server's answer rather
 * than keeping a second copy of the registry — the same rule
 * `getNotificationEvents` follows, and for the same reason: two declarations
 * drift, and the drift shows up as a model selector for a persona nothing
 * invokes.
 */
export interface AiPersona {
  key: string;
  label: string;
  description: string;
  tier: AiPersonaTier;
  capabilities: AiPersonaCapability[];
}

/**
 * What the page knows about the stored platform key without being told the key.
 *
 * `hint` is the credential store's own mask (`••••` plus at most the last four
 * characters). The key itself is never returned by any endpoint.
 */
export interface AiPlatformKeyStatus {
  configured: boolean;
  hint: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

/** `GET /api/ai-settings` — the configuration plus what the page cannot derive. */
export interface AiSettings {
  /** `null` is "no provider chosen" — a persisted state, not a missing key. */
  provider: AiProviderKind | null;
  /** The master switch. A separate axis from `provider`, exactly as for email. */
  enabled: boolean;
  /** Override for the provider base URL. Absent means the deployment default. */
  baseUrl?: string;
  defaultModel: string | null;
  /**
   * Sparse per-persona overrides: an absent key means "use `defaultModel`", and
   * an explicit `null` means the same thing after a round trip through the form.
   */
  personaModels: Partial<Record<string, string | null>>;
  platformKeyStatus: AiPlatformKeyStatus;
  /** Why a stored row would not parse. FIELD PATHS ONLY. Null normally. */
  settingsError: string | null;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; email: string } | null;
}

/**
 * `PUT /api/ai-settings`.
 *
 * A full replacement plus the version the caller believed it was replacing
 * (sent as `If-Match`, not in this body).
 *
 * BLANK PRESERVES, exactly as for the SMTP password: `platformApiKey` omitted
 * leaves the stored key alone, and there is deliberately no way to erase one by
 * clearing the field — "I left the box alone" and "I want no key" are the same
 * gesture, and guessing wrong in the destructive direction silently breaks AI
 * for the whole deployment.
 */
export interface AiSettingsInput {
  provider: AiProviderKind | null;
  enabled: boolean;
  baseUrl?: Blankable<string>;
  defaultModel: string | null;
  personaModels: Partial<Record<string, string | null>>;
  platformApiKey?: string;
}

/** One entry of the provider's catalog, already filtered to GPT >= 5.4. */
export interface AiModelInfo {
  id: string;
  created: number;
}

/**
 * `GET /api/ai-settings/models` — 200 in every configuration.
 *
 * RESOLVES ON FAILURE, like the test endpoints: read `success`, never the HTTP
 * status. `models` can be non-empty on a failure, with `source: 'cache'`, which
 * the page must render as stale rather than as live.
 */
export interface AiModelsResult {
  success: boolean;
  models: AiModelInfo[];
  fetchedAt: string | null;
  source: 'live' | 'cache' | null;
  error: string | null;
}

/** One probe's outcome. `skipped` is a first-class, non-failing state. */
export type AiTestCheck = 'passed' | 'failed' | 'skipped';

/**
 * `POST /api/ai-settings/test` and `POST /api/me/ai-key/test` — one shape.
 *
 * The two endpoints answer different questions with different keys, but the
 * component rendering the answer is the same in both variants, and two shapes
 * would mean two renderers for one sentence.
 *
 * Every field except `error` is optional so a client-side failure (a 403, a
 * dropped connection) can be represented in the same object without inventing
 * values the server never sent.
 */
export interface AiTestResult {
  success: boolean;
  providerKind?: AiProviderKind | null;
  model?: string | null;
  latencyMs?: number | null;
  /** The provider's verbatim message, already redacted server-side. */
  error: string | null;
  attemptedAt?: string;
  checks?: { listModels: AiTestCheck; generate: AiTestCheck };
}

/**
 * `GET /api/me/ai-key` — everything the key page and the setup page render.
 *
 * `lastTest` is derived by the API from the `ai_invocations` telemetry table
 * rather than stored on the credential, so there is one source of truth for it.
 *
 * `platform` reports just enough of the deployment's configuration to explain a
 * skipped generate probe. Without it a user whose test says
 * `generate: 'skipped'` cannot tell whether their key is half-working or whether
 * nobody has chosen a model yet — and the second is not theirs to fix.
 */
export interface MyAiKeyStatus {
  configured: boolean;
  hint: string | null;
  updatedAt: string | null;
  lastTest: {
    attemptedAt: string;
    success: boolean;
    model: string | null;
    error: string | null;
  } | null;
  platform: {
    provider: AiProviderKind | null;
    enabled: boolean;
    hasDefaultModel: boolean;
  };
}

// =============================================================================
// EvolvePath product domain (epic #33)
// =============================================================================
//
// String unions mirroring the Prisma enums in `apps/api/prisma/schema.prisma`.
// They are hand-maintained rather than generated, and the cost of that is one
// place to update when the schema changes — accepted because generating types
// from Prisma would put the API's build output on the web app's critical path
// for a set of values that changes about once an epic.
//
// The API is the only authority on what a user may see. Nothing in these types
// or in the components over them makes an authorization decision: an id that
// is not yours answers 404, and that 404 is the truth.
// =============================================================================

export type Domain = 'WORK' | 'FAMILY' | 'HEALTH';
export type OutcomeState = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
export type PlanVersionStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'REJECTED';
export type PlanAuthor = 'USER' | 'AI';
export type RoutineTriggerType = 'TIME' | 'EVENT';
export type RoutineFrequency = 'DAILY' | 'WEEKDAYS' | 'WEEKENDS' | 'WEEKLY' | 'CUSTOM';
export type CommitmentStatus =
  | 'PLANNED'
  | 'READY'
  | 'STARTED'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'RESCHEDULED'
  | 'SKIPPED'
  | 'MISSED'
  | 'CANCELLED';
export type EvidenceSource = 'USER_LOG' | 'TIMER' | 'WORKOUT_LOG' | 'APP_FLOW';
export type DomainModeKind = 'GROW' | 'MAINTAIN' | 'RECOVER' | 'PAUSE';

/** The three domains in render order — the same order the API returns. */
export const DOMAIN_ORDER: readonly Domain[] = ['WORK', 'FAMILY', 'HEALTH'];

export const DOMAIN_LABELS: Record<Domain, string> = {
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
};

export interface BestSelfProfile {
  id: string;
  identityStatement: string | null;
  workIdentity: string | null;
  familyIdentity: string | null;
  healthIdentity: string | null;
  sixMonthVision: string | null;
  motivations: string[];
  reasons: string[];
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BestSelfInput {
  identityStatement?: string | null;
  workIdentity?: string | null;
  familyIdentity?: string | null;
  healthIdentity?: string | null;
  sixMonthVision?: string | null;
  motivations?: string[];
  reasons?: string[];
}

export interface ActivePlanVersionSummary {
  id: string;
  version: number;
}

export interface Outcome {
  id: string;
  domain: Domain;
  title: string;
  description: string | null;
  /** `YYYY-MM-DD`, not an instant — a target date has no time of day. */
  targetDate: string | null;
  importance: number;
  motivation: string | null;
  state: OutcomeState;
  successDefinition: string | null;
  userConfidence: number | null;
  archivedAt: string | null;
  planId: string | null;
  activePlanVersion: ActivePlanVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutcomeInput {
  domain?: Domain;
  title?: string;
  description?: string | null;
  targetDate?: string | null;
  importance?: number;
  motivation?: string | null;
  successDefinition?: string | null;
  userConfidence?: number | null;
  /** ARCHIVED is not settable here — it is reached through the archive route. */
  state?: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
}

export interface PlanVersionSummary {
  id: string;
  version: number;
  status: PlanVersionStatus;
  rationale: string | null;
  createdBy: PlanAuthor;
  userApproved: boolean;
  previousVersionId: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  routineCount: number;
  createdAt: string;
}

export interface PlanVersion extends PlanVersionSummary {
  planId: string;
  expectedWeeklyLoad: number | null;
  fallbackStrategy: string | null;
  routines: Routine[];
}

export interface Plan {
  id: string;
  outcomeId: string;
  activeVersion: PlanVersionSummary | null;
  versionCount: number;
  createdAt: string;
}

export interface PlanInput {
  rationale?: string | null;
  expectedWeeklyLoad?: number | null;
  fallbackStrategy?: string | null;
  routines?: RoutineInput[];
}

export interface PlanVersionInput {
  /** Required by the API: PRD §80 wants "why it changed" always renderable. */
  rationale: string;
  expectedWeeklyLoad?: number | null;
  fallbackStrategy?: string | null;
  copyRoutinesFrom?: 'active' | 'none';
}

export interface Routine {
  id: string;
  planVersionId: string;
  title: string;
  domain: Domain;
  triggerType: RoutineTriggerType;
  triggerValue: string | null;
  frequency: RoutineFrequency;
  /** 0 = Sunday … 6 = Saturday. Only meaningful when `frequency` is CUSTOM. */
  daysOfWeek: number[];
  preferredTime: string | null;
  estimatedDurationMin: number;
  minimumDurationMin: number;
  fallbackBehavior: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineInput {
  planVersionId?: string;
  title?: string;
  domain?: Domain;
  triggerType?: RoutineTriggerType;
  triggerValue?: string | null;
  frequency?: RoutineFrequency;
  daysOfWeek?: number[];
  preferredTime?: string | null;
  estimatedDurationMin?: number;
  minimumDurationMin?: number;
  fallbackBehavior?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export interface Commitment {
  id: string;
  domain: Domain;
  title: string;
  outcomeId: string | null;
  planVersionId: string | null;
  routineId: string | null;
  /** The family ritual that materialized this occurrence, and who it is with. */
  ritualId: string | null;
  familyMemberId: string | null;
  /** The workout this commitment runs, when it is one (epic E09). */
  workoutTemplateId?: string | null;
  scheduledStart: string;
  scheduledEnd: string | null;
  importance: number;
  commitmentType: string | null;
  fullVersion: string | null;
  shortVersion: string | null;
  minimumVersion: string | null;
  fullMinutes: number | null;
  shortMinutes: number | null;
  minimumMinutes: number | null;
  status: CommitmentStatus;
  /**
   * Computed by the API from its own matrix. The UI renders EXACTLY these, so
   * a client running an older bundle can never offer a move the API refuses —
   * `utils/commitmentTransitions.ts` exists only for optimistic rendering.
   */
  allowedTransitions: CommitmentStatus[];
  rescheduleCount: number;
  rescheduledFromId: string | null;
  rescheduledToId: string | null;
  skipReason: string | null;
  userConfirmed: boolean;
  startedAt: string | null;
  completedAt: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommitmentDetail extends Commitment {
  evidence: Evidence[];
  reflections: Reflection[];
}

export interface CommitmentInput {
  domain: Domain;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  importance?: number;
  commitmentType?: string | null;
  outcomeId?: string | null;
  planVersionId?: string | null;
  routineId?: string | null;
  fullVersion?: string | null;
  shortVersion?: string | null;
  minimumVersion?: string | null;
  /** How long each declared size takes. `minimum <= short <= full`. */
  fullMinutes?: number | null;
  shortMinutes?: number | null;
  minimumMinutes?: number | null;
  userConfirmed?: boolean;
}

export interface TransitionEvidenceInput {
  evidenceType?: string;
  quantitativeValue?: number;
  quantitativeUnit?: string | null;
  qualitativeValue?: string | null;
}

export interface TransitionInput {
  to: CommitmentStatus;
  reason?: string | null;
  /** ISO 8601 with offset. Required when `to` is RESCHEDULED, rejected otherwise. */
  rescheduleTo?: string;
  /** Only ever accepted with COMPLETED or PARTIALLY_COMPLETED. */
  evidence?: TransitionEvidenceInput;
}

export interface TransitionResult {
  commitment: Commitment;
  /** The new PLANNED commitment a reschedule opened; null otherwise. */
  rescheduledTo: Commitment | null;
  evidence: Evidence | null;
}

export interface Evidence {
  id: string;
  commitmentId: string | null;
  evidenceType: string;
  source: EvidenceSource;
  occurredAt: string;
  quantitativeValue: number | null;
  quantitativeUnit: string | null;
  qualitativeValue: string | null;
  confidence: number | null;
  createdAt: string;
}

export interface Reflection {
  id: string;
  relatedType: string;
  relatedId: string | null;
  userText: string | null;
  aiSummary: string | null;
  frictionTags: string[];
  mood: number | null;
  perceivedDifficulty: number | null;
  satisfaction: number | null;
  createdAt: string;
}

export interface DomainMode {
  domain: Domain;
  mode: DomainModeKind;
  reason: string | null;
  /** Null for a domain the user has never set — no row exists for it. */
  effectiveFrom: string | null;
}

// ===========================================================================
// The Today screen (epic E05)
// ===========================================================================
//
// Hand-maintained mirrors of the API's Zod schemas (`apps/api/src/today/`
// and `apps/api/src/commitments/commitment-card.schema.ts`). Generating them
// would put the API's build output on this app's critical path for values that
// change about once an epic; the reconciliation surface is these types plus the
// EvolvePath block at the bottom of `services/api.ts`, and nothing else.
// ===========================================================================

/** One of the three sizes of an intention, with its cost. */
export interface CommitmentVersionView {
  title: string;
  minutes: number;
}

export type CommitmentActionName =
  | 'start'
  | 'pause'
  | 'continue'
  | 'complete'
  | 'partial'
  | 'fallback'
  | 'reschedule'
  | 'skip'
  | 'decompose';

export type CommitmentVersionUsed = 'FULL' | 'SHORT' | 'MINIMUM';

/**
 * Server-derived timer state. Null for a commitment nobody has started.
 *
 * `activeSeconds` is what was banked at the last pause, NOT the total — a
 * screen counting seconds adds `now − activeSince` itself rather than polling.
 * `elapsedSeconds` is the server's own arithmetic at read time, which is what a
 * reloaded page resumes from.
 */
export interface CommitmentTimer {
  activeSince: string | null;
  activeSeconds: number;
  elapsedSeconds: number;
  timerMinutes: number | null;
  remainingSeconds: number | null;
}

/**
 * The shape every actionable surface renders: Today's domain sections and the
 * body every `/commitments/:id/actions/*` route returns.
 *
 * Distinct from `Commitment` (the record, every column). This is the view — what
 * to show, how long it takes, and what the server will accept next.
 */
export interface CommitmentCard {
  id: string;
  title: string;
  domain: Domain;
  status: CommitmentStatus;
  scheduledStart: string;
  scheduledEnd: string | null;
  durationMinutes: number;
  versions: {
    full: CommitmentVersionView;
    short: CommitmentVersionView | null;
    minimum: CommitmentVersionView | null;
  };
  importance: number;
  rescheduleCount: number;
  startedAt: string | null;
  completedAt: string | null;
  versionUsed: CommitmentVersionUsed | null;
  minutesSpent: number | null;
  outcomeId: string | null;
  /**
   * The family ritual this occurrence came from, and who it is with (epic E08).
   *
   * The row reads them to pick action LABELS — "I'm in" / "Move it" /
   * "Skip today" instead of "Ready" / "Reschedule" / "Skip" — over the same
   * endpoints and the same matrix. Labels only; nothing else changes.
   */
  ritualId: string | null;
  familyMemberId: string | null;
  /**
   * The workout this commitment runs, when it is one (epic E09).
   *
   * Read for the same kind of reason as `ritualId`: the row's primary action
   * comes from it. With a template, "Start workout" opens the runner; without
   * one, "Start" opens the generic timer. Inferring it from the domain would be
   * wrong the moment somebody schedules a walk.
   */
  workoutTemplateId: string | null;
  decomposedFromId: string | null;
  steps: CommitmentVersionView[] | null;
  timer: CommitmentTimer | null;
  /**
   * What the server will accept next. THE UI RENDERS THIS LIST — it does not
   * compute one. A bundle running yesterday's rules would otherwise offer a
   * move this API refuses.
   */
  availableActions: CommitmentActionName[];
}

export type InterventionMode =
  | 'ACT'
  | 'CLARIFY'
  | 'REDUCE'
  | 'DIAGNOSE'
  | 'RECONNECT'
  | 'CHALLENGE_PLAN'
  | 'RECOVER'
  | 'REINFORCE';

export interface NextBestAction {
  commitmentId: string;
  title: string;
  domain: Domain;
  durationMinutes: number;
  version: 'full' | 'short' | 'minimum';
  /** Deterministic and server-built. Present even when the coach is down. */
  rationale: string;
  fallback: { title: string; durationMinutes: number };
  interventionMode: InterventionMode;
  confidence: number;
}

export type CheckInFeel = 'NORMAL' | 'PACKED' | 'LOW_ENERGY' | 'UNEXPECTED_PROBLEM';

export interface DailyCheckIn {
  dateLocal: string;
  feel: CheckInFeel;
  updatedAt: string;
}

export interface TodayDomainSection {
  domain: Domain;
  mode: DomainModeKind;
  commitments: CommitmentCard[];
}

export interface TodayResponse {
  greeting: 'morning' | 'afternoon' | 'evening';
  stateLine: string;
  dateLocal: string;
  timeZone: string;
  checkIn: { feel: CheckInFeel } | null;
  /** Null when there is nothing to recommend. An empty day is not a failure. */
  nextBestAction: NextBestAction | null;
  /** Always three, in canonical order, including the empty and the paused. */
  domains: TodayDomainSection[];
  /**
   * `null` until E11 and E05-01 respectively fill them. Typed here rather than
   * omitted so those epics change one line in one place.
   */
  momentum: null;
  coachInsight: null;
}

export interface TodayInsight {
  text: string;
  /** `template` means the coach was unavailable — not an error state. */
  source: 'ai' | 'template';
  generatedAt: string;
}

export type ReflectionQuickOption =
  | 'PLAN_WORKED'
  | 'TOO_MUCH'
  | 'BAD_TIMING'
  | 'UNEXPECTED_CONFLICT'
  | 'LOW_ENERGY'
  | 'AVOIDED'
  | 'OTHER';

export interface DayReflection {
  id: string;
  dateLocal: string;
  quickOption: ReflectionQuickOption;
  text: string | null;
  createdAt: string;
}

/** PRD §74's options minus `PLAN_WORKED`, which is not a reason to skip. */
export type SkipReason =
  | 'TOO_MUCH'
  | 'BAD_TIMING'
  | 'UNEXPECTED_CONFLICT'
  | 'LOW_ENERGY'
  | 'AVOIDED'
  | 'OTHER';

export interface DecompositionStep {
  title: string;
  minutes: number;
}

export interface DecompositionProposal {
  steps: DecompositionStep[];
  /** At most 15 minutes: the whole point is to make starting cheap. */
  firstStep: DecompositionStep;
  message: string;
  source: 'ai' | 'template';
}

/**
 * The card an execution screen reads, with the outcome's motivation joined.
 *
 * PRD §27 puts "why it matters" on the Start screen deliberately — a timer with
 * no reason attached is a stopwatch.
 */
export interface StartContext extends CommitmentCard {
  whyItMatters: string | null;
}

export interface CompleteCommitmentInput {
  notes?: string | null;
  minutesSpent?: number | null;
}

// =============================================================================
// The Family domain (epic E08)
// =============================================================================
//
// Mirrors `apps/api/src/family/*.schema.ts` field for field. Hand-maintained on
// purpose: generating them would put the API's build output on this app's
// critical path for values that change about once an epic.
// =============================================================================

export type FamilyRelationship =
  | 'PARTNER'
  | 'CHILD'
  | 'PARENT'
  | 'SIBLING'
  | 'FRIEND'
  | 'OTHER';

/**
 * Exactly five fields, and there is no sixth to add.
 *
 * PRD §33 fixes the record and VISION §50 explains it: the people in it never
 * consented to being modeled. The card renders these and requests nothing else.
 */
export interface FamilyMember {
  id: string;
  nickname: string;
  relationship: FamilyRelationship;
  /** `YYYY-MM-DD`. The year may be the 1900 placeholder and is never shown. */
  birthday: string | null;
  createdAt: string;
}

export interface FamilyMemberInput {
  nickname: string;
  relationship: FamilyRelationship;
  birthday?: string | null;
}

export interface RitualRecurrence {
  /** `0 = Sunday … 6 = Saturday`. Display order is Monday-first; values are not. */
  weekdays: number[];
  /** `HH:mm` in the user's own timezone. */
  time: string;
  everyNWeeks: 1 | 2 | 4;
}

export interface Ritual {
  id: string;
  title: string;
  purpose: string | null;
  familyMemberId: string | null;
  recurrence: RitualRecurrence;
  idealMinutes: number;
  minimumMinutes: number;
  fallbackBehavior: string | null;
  active: boolean;
  lastMaterializedThrough: string | null;
  routineId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RitualWithUpcoming extends Ritual {
  upcoming: CommitmentCard[];
}

export interface RitualInput {
  title?: string;
  purpose?: string | null;
  familyMemberId?: string | null;
  recurrence?: RitualRecurrence;
  idealMinutes?: number;
  minimumMinutes?: number;
  fallbackBehavior?: string | null;
  outcomeId?: string | null;
  active?: boolean;
}

/**
 * The answer from `POST /family/lint`, and from a 400's `details` — the two
 * carry the same three fields, so one type serves the debounced check and the
 * server's refusal alike.
 */
export interface LintResult {
  ok: boolean;
  code: 'TARGETS_OTHER_PERSON' | null;
  match: string | null;
  /** Offered, never applied. `null` when AI is unavailable. */
  suggestion: string | null;
  source: 'ai' | 'none';
}

export interface MaterializeResult {
  created: number;
  skipped: number;
  through: string;
}

/** Integers only. There is no ratio here, and adding one is not a small change. */
export interface RitualWeekCounts {
  /** `null` groups the ad-hoc family commitments. */
  ritualId: string | null;
  title: string;
  planned: number;
  kept: number;
  partial: number;
  moved: number;
  skipped: number;
  missed: number;
  open: number;
}

export interface FamilySummaryWeek {
  weekStart: string;
  rituals: RitualWeekCounts[];
  totals: Omit<RitualWeekCounts, 'ritualId' | 'title'>;
}

export interface FamilySummary {
  timezone: string;
  /** Newest first. */
  weeks: FamilySummaryWeek[];
  coachNote: { text: string; source: 'ai' | 'template' } | null;
}

// =============================================================================
// The AI coach (epic E06)
// =============================================================================
//
// Hand-maintained mirrors of `apps/api/src/coach/`. They are hand-maintained
// deliberately — generating them would put the API's build output on the web
// app's critical path for values that change about once an epic — and this
// block plus the EvolvePath section of `services/api.ts` is the entire
// reconciliation surface if a field moves.

export const INTERVENTION_TYPES = [
  'NORMAL_REMINDER',
  'ACTIVATION_REDUCTION',
  'DECOMPOSITION',
  'FRICTION_DIAGNOSIS',
  'ENVIRONMENT_CHANGE',
  'PLAN_CHALLENGE',
  'GOAL_CHALLENGE',
  'REINFORCE',
  'CLARIFY',
  'REDUCE_SCOPE',
  'RECONNECT_REASON',
  'RECOVER',
] as const;

export type InterventionType = (typeof INTERVENTION_TYPES)[number];

export interface CoachConversation {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string;
}

export type PlanChangeOp = 'move' | 'reduce' | 'replace' | 'add' | 'remove' | 'pause';

export interface RoutineSnapshot {
  title?: string;
  triggerType?: 'TIME' | 'EVENT';
  triggerValue?: string | null;
  frequency?: string;
  daysOfWeek?: number[];
  preferredTime?: string | null;
  estimatedDurationMin?: number;
  minimumDurationMin?: number;
  fallbackBehavior?: string | null;
  active?: boolean;
}

export interface PlanChange {
  op: PlanChangeOp;
  target: { type: 'routine' | 'commitment'; id: string | null };
  before: RoutineSnapshot | null;
  after: RoutineSnapshot | null;
  reason: string;
}

/** One row of the diff the user reads before deciding. */
export interface DiffEntry {
  op: PlanChangeOp;
  target: { type: 'routine' | 'commitment'; id: string; title: string };
  reason: string;
  fields: Array<{ field: string; before: unknown; after: unknown }>;
}

export interface CoachReply {
  intervention_type: InterventionType;
  /** Shown under "Why this?". A summary, never chain of thought (PRD §16). */
  reasoning_summary: string;
  user_message: string;
  recommended_action: {
    title: string;
    duration_minutes: number;
    commitmentId: string | null;
  } | null;
  fallback_action: { title: string; duration_minutes: number } | null;
  proposal: {
    kind: 'plan_change';
    planId: string;
    summary: string;
    changes: PlanChange[];
    /** Present once the turn created the row. */
    proposalId?: string;
  } | null;
  friction_question: { prompt: string; options: string[] } | null;
}

export interface SafetyInfo {
  decision: 'allow' | 'conservative' | 'redirect';
  category: string;
  userFacingNote?: string;
}

export interface CoachMessage {
  id: string;
  role: 'USER' | 'COACH' | 'SYSTEM';
  content: string;
  /** Null on USER/SYSTEM rows AND on template fallbacks — see `degraded`. */
  structured: CoachReply | null;
  attachmentIds: string[];
  safety: SafetyInfo | null;
  createdAt: string;
  /**
   * Client-only, on the optimistic USER bubble. Never sent to the API, and
   * absent on every row that came back from it.
   */
  status?: 'pending' | 'sent' | 'failed';
}

export type ProposalStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'EDITED'
  | 'REJECTED'
  | 'EXPIRED';

export interface ProposalSummary {
  id: string;
  planId: string;
  sourceKind: string;
  status: ProposalStatus;
  summary: string;
  changeCount: number;
  edited: boolean;
  expiresAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  appliedPlanVersionId: string | null;
  createdAt: string;
  plan: { id: string; outcomeTitle: string; domain: Domain };
}

export interface ProposalDetail extends ProposalSummary {
  changes: PlanChange[];
  originalChanges: PlanChange[] | null;
  preview: {
    diff: DiffEntry[];
    errors: Array<{ index: number; code: string; message: string }>;
  };
  activeVersion: { id: string; version: number } | null;
}

export interface SendCoachMessageResult {
  conversationId: string;
  userMessage: CoachMessage;
  coachMessage: CoachMessage;
  proposal?: ProposalSummary;
  /** The reply is a template, not model output. Still a 201. */
  degraded: boolean;
}

export interface SuggestedPrompt {
  key: string;
  label: string;
  text: string;
}

// =============================================================================
// What the coach remembers (epic E06, issue #78)
// =============================================================================

export const MEMORY_INSIGHT_CATEGORIES = [
  'IDENTITY',
  'WORK',
  'FAMILY',
  'HEALTH',
  'COACHING_PREFERENCE',
  'NOTIFICATION_PREFERENCE',
  'PATTERN',
] as const;

export type MemoryInsightCategory = (typeof MEMORY_INSIGHT_CATEGORIES)[number];

export interface MemoryInsight {
  id: string;
  category: MemoryInsightCategory;
  statement: string;
  evidenceCount: number;
  /** 0–1. Rendered as words, never as a number (see `MemoryInsightRow`). */
  confidence: number;
  /** "The user says this is true." The coach uses only confirmed insights. */
  userConfirmed: boolean;
  /** "Never bring this up." A different question from `userConfirmed`. */
  doNotUse: boolean;
  expiresAt: string | null;
  source: 'AI' | 'USER';
  createdAt: string;
  updatedAt: string;
}

export interface ProposeInsightsResult {
  created: MemoryInsight[];
  /** Never an error: a proposer that cannot run is not a broken screen. */
  skipped: 'insufficient_data' | 'ai_unavailable' | null;
}

// =============================================================================
// The weekly loop (epic E10)
// =============================================================================
//
// Hand-maintained mirrors of the API DTOs, like every other type in this file.
// Generating them would put the API's build output on the web app's critical
// path for values that change about once an epic.

export type WeeklyReviewStatus = 'GENERATING' | 'READY' | 'APPROVED' | 'SKIPPED';
export type WeeklyPlanStatus = 'DRAFT' | 'APPROVED';

export interface DomainCounts {
  planned: number;
  completed: number;
  partial: number;
  missed: number;
  unresolved: number;
  skipped: number;
  rescheduled: number;
  started: number;
  fallbackUsed: number;
  minutesPlanned: number;
  minutesSpent: number;
  completionRate: number;
}

export type WeekTimeWindow =
  | 'early_morning'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'evening'
  | 'night';

export interface WeekAggregates {
  weekStart: string;
  timezone: string;
  /** `partial` is true while the week is still running — a caption, not a flaw. */
  coverage: { from: string; to: string; partial: boolean };
  domains: Record<Domain, DomainCounts>;
  totals: DomainCounts;
  timeWindows: Array<{
    window: WeekTimeWindow;
    planned: number;
    completed: number;
    successRate: number;
  }>;
  weekdays: Array<{ weekday: number; planned: number; completed: number }>;
  rescheduleLeaders: Array<{
    commitmentId: string;
    title: string;
    domain: Domain;
    rescheduleCount: number;
  }>;
  focusStarts: { planned: number; started: number; completed: number };
  workouts: {
    planned: number;
    completed: number;
    fallbackUsed: number;
    sessionsLogged: number;
  };
  frictionTags: Array<{ tag: string; count: number }>;
}

/**
 * PRD §14.4: three separate claims, and the screen labels each. `inference` and
 * `recommendation` are null on a template summary, because a template is not
 * allowed to guess.
 */
export interface ReviewPattern {
  observation: string;
  inference: string | null;
  recommendation: string | null;
  confidence: number;
  domain: Domain | null;
}

export interface WeeklyReviewAiSummary {
  whatWorked: string[];
  whatDidNot: string[];
  patterns: ReviewPattern[];
  proposedChanges: Array<{ planId: string; summary: string }>;
  keepUnchanged: string[];
  doNotAddYet: string[];
  /** `'template'` means the coach was unavailable and the numbers are unchanged. */
  source: 'ai' | 'template';
  promptVersion: string | null;
  generatedAt: string;
}

export interface WeeklyReviewSummary {
  id: string;
  weekStart: string;
  status: WeeklyReviewStatus;
  counts: Record<Domain, { planned: number; completed: number }>;
  generatedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface WeeklyReviewDetail extends WeeklyReviewSummary {
  aggregates: WeekAggregates;
  aiSummary: WeeklyReviewAiSummary | null;
  proposals: ProposalDetail[];
  plan: { id: string; status: WeeklyPlanStatus } | null;
}

export interface WeeklySettings {
  /** 0 = Sunday … 6 = Saturday. */
  weeklyReviewWeekday: number;
  weeklyReviewTime: string;
  timezone: string;
  nextReviewAt: string;
}

export interface WeeklyPlanConstraints {
  travelDays: string[];
  fixedEvents: Array<{
    date: string;
    title: string;
    /** Both null means the event blocks the whole day. */
    startTime: string | null;
    endTime: string | null;
  }>;
  notes: string | null;
}

export type WeeklyDomainModes = Partial<Record<Domain, DomainModeKind>>;

export interface ProposedCommitment {
  key: string;
  source: 'routine' | 'extra';
  include: boolean;
  domain: Domain;
  title: string;
  date: string;
  startTime: string;
  estimatedMinutes: number;
  minimumMinutes: number | null;
  routineId: string | null;
  planVersionId: string | null;
  outcomeId: string | null;
  fullVersion: string | null;
  shortVersion: string | null;
  minimumVersion: string | null;
  recurring: boolean;
  /** Why this occurrence is greyed out. Never omitted from the list. */
  excludedBy: 'travel_day' | 'fixed_event' | 'paused_domain' | null;
}

export interface ExtraCommitment {
  domain: Domain;
  title: string;
  date: string;
  startTime: string;
  estimatedMinutes: number;
  minimumVersion?: string | null;
  recurring: boolean;
}

export interface LoadWarning {
  code: 'RECURRING_OVER_CAP' | 'MINUTES_OVER_CAPACITY' | 'DAY_OVER_CAPACITY';
  message: string;
  suggestion: string;
  detail: Record<string, unknown>;
}

export interface WeeklyPlanProposal {
  items: ProposedCommitment[];
  extras: ExtraCommitment[];
  summary: {
    recurringCount: number;
    estimatedMinutes: number;
    byDomain: Record<Domain, { count: number; minutes: number }>;
    softCap: number;
    capacityMinutes: number | null;
  };
  warnings: LoadWarning[];
  proposedAt: string;
}

export interface WeeklyPlanSummary {
  id: string;
  weekStart: string;
  status: WeeklyPlanStatus;
  primaryFocus: string | null;
  reviewId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface WeeklyPlanDetail extends WeeklyPlanSummary {
  constraints: WeeklyPlanConstraints;
  domainModes: WeeklyDomainModes;
  proposal: WeeklyPlanProposal | null;
  review: { id: string; weekStart: string; status: WeeklyReviewStatus } | null;
}

export interface ApproveWeeklyPlanResult {
  plan: WeeklyPlanDetail;
  createdCommitmentIds: string[];
  skippedExisting: number;
  warnings: LoadWarning[];
}

// =============================================================================
// The Health domain (epic E09)
// =============================================================================

export type BehaviourTime = 'MORNING' | 'MIDDAY' | 'EVENING';

export interface BehaviourVersion {
  title: string;
  minutes: number;
}

/** PRD §46's V1 nutrition scope: behaviours, never calories or macros. */
export interface NutritionBehaviour {
  key: string;
  title: string;
  description: string;
  defaultTime: BehaviourTime;
  fullVersion: BehaviourVersion;
  minimumVersion: BehaviourVersion;
}

export interface BodyWeightLog {
  dateLocal: string;
  weightKg: number;
}

export interface WeightTrendPoint {
  dateLocal: string;
  /** Null where fewer than two readings fall in the seven-day window. */
  rolling7Kg: number | null;
}

/**
 * PRD §47. There is deliberately no per-day classification on this type, and
 * there must never be one: the promise is that a single measurement is never
 * called a bad day, and the way to keep it is for the field not to exist.
 */
export interface WeightTrend {
  items: BodyWeightLog[];
  trend: WeightTrendPoint[];
  summary: { first: number; last: number; deltaKg: number; days: number } | null;
}

// -----------------------------------------------------------------------------
// Workout programs (epic E09)
// -----------------------------------------------------------------------------

export type Equipment =
  | 'BODYWEIGHT'
  | 'DUMBBELL'
  | 'BARBELL'
  | 'MACHINE'
  | 'CABLE'
  | 'KETTLEBELL'
  | 'BAND'
  | 'BENCH';

export type WorkoutVariant = 'FULL' | 'SHORT' | 'MINIMUM';

export type WorkoutProgramStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface Exercise {
  id: string;
  name: string;
  equipment: string[];
  movementPattern: string;
  instructions: string;
  contraindicationTags: string[];
  substitutionGroup: string;
  isCustom: boolean;
}

export interface WorkoutTemplateExercise {
  id: string;
  exerciseId: string;
  name: string;
  order: number;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  notes: string | null;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  variant: WorkoutVariant;
  targetMinutes: number;
  routineId: string | null;
  exercises: WorkoutTemplateExercise[];
}

export interface WeeklyStructureEntry {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  templateId: string;
}

export interface WorkoutProgramSummary {
  id: string;
  name: string;
  status: WorkoutProgramStatus;
  durationWeeks: number;
  weeklyStructure: WeeklyStructureEntry[];
  planId: string | null;
  createdAt: string;
}

export interface WorkoutProgram extends WorkoutProgramSummary {
  rationale: string | null;
  templates: WorkoutTemplate[];
  substitutions: Array<{ exerciseId: string; alternativeExerciseIds: string[] }>;
}

export interface GenerateProgramRequest {
  goal: string;
  experience: 'BEGINNER' | 'INTERMEDIATE';
  daysPerWeek: number;
  minutesPerSession: number;
  equipment: Equipment[];
  preferences?: string;
  limitations?: string;
  useStarter?: boolean;
}

/**
 * `source: 'starter'` is a SUCCESS, not an error: the deterministic program
 * shipped because the model could not (PRD §120). `reason` says which of the
 * four ways that happened, and the UI owes the user a different sentence for
 * each.
 */
export interface GenerateProgramResult {
  program: WorkoutProgram;
  source: 'ai' | 'starter';
  reason: 'invalid_output' | 'ai_unavailable' | 'safety_redirect' | 'requested' | null;
  message: string | null;
}

export interface ApproveProgramResult {
  program: WorkoutProgram;
  planVersionId: string;
  commitmentIds: string[];
}

// -----------------------------------------------------------------------------
// The workout runner (epic E09)
// -----------------------------------------------------------------------------

export type Discomfort = 'NONE' | 'MILD' | 'SHARP_PAIN';

export type WorkoutSessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export interface SetLog {
  id: string;
  /** Minted by THIS client. The whole of the offline-replay guarantee. */
  clientId: string;
  exerciseId: string;
  setNumber: number;
  weightKg: number | null;
  reps: number;
  rpe: number | null;
  discomfort: Discomfort;
  loggedAt: string;
}

export type ProgressionAction = 'increase' | 'hold' | 'reduce';

export interface ProgressionSuggestion {
  action: ProgressionAction;
  currentWeightKg: number | null;
  suggestedWeightKg: number | null;
  deltaKg: number | null;
  reason:
    | 'top_of_range_twice'
    | 'below_min_twice'
    | 'first_session'
    | 'building'
    | 'discomfort'
    | 'insufficient_history';
  basis: { sessions: number; lastReps: number[]; lastRpe: Array<number | null> };
}

export interface SessionExercise {
  order: number;
  exerciseId: string;
  name: string;
  equipment: string[];
  instructions: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  notes: string | null;
  lastTime: { sessionDate: string; sets: SetLog[] } | null;
  progression: ProgressionSuggestion | null;
  logged: SetLog[];
}

export interface WorkoutSessionSummary {
  id: string;
  status: WorkoutSessionStatus;
  variant: WorkoutVariant;
  templateId: string;
  templateName: string;
  startedAt: string;
  finishedAt: string | null;
  discomfortFlag: boolean;
  commitmentId: string | null;
  setCount: number;
}

export interface WorkoutSessionView extends WorkoutSessionSummary {
  program: { id: string; name: string };
  template: { id: string; name: string; variant: WorkoutVariant; targetMinutes: number };
  header: { title: string; sessionIndex: number; sessionTotal: number };
  availableVariants: WorkoutVariant[];
  exercises: SessionExercise[];
  /** Sets for movements the current variant does not include. They happened. */
  alsoLogged: SetLog[];
  safety: { copy: string } | null;
}

export interface LogSetBody {
  clientId: string;
  exerciseId: string;
  setNumber: number;
  weightKg?: number | null;
  reps: number;
  rpe?: number | null;
  discomfort: Discomfort;
  loggedAt?: string;
}

export interface LogSetResult {
  set: SetLog;
  safety: { copy: string; action: string } | null;
}

export interface LogSetBatchResult {
  accepted: SetLog[];
  duplicates: string[];
  rejected: Array<{ clientId: string; reason: string }>;
}

export interface FinishSummary {
  sets: number;
  volumeKg: number;
  minutes: number;
  exercisesCompleted: number;
  exercisesPlanned: number;
}

export interface FinishSessionResult {
  session: WorkoutSessionSummary;
  summary: FinishSummary;
  commitmentStatus: string | null;
}

// -----------------------------------------------------------------------------
// Health media coaching (epic E09)
// -----------------------------------------------------------------------------

export interface StorageObjectSummary {
  id: string;
  name: string;
  mimeType: string;
  status: string;
}

export type RiskFlag =
  | 'pain_reported'
  | 'joint_instability'
  | 'spinal_rounding_under_load'
  | 'loss_of_control'
  | 'unclear_footage'
  | 'none';

export interface FormCheckResult {
  observations: string[];
  cues: string[];
  riskFlags: RiskFlag[];
  safetyNote: string | null;
  confidence: 'low' | 'medium' | 'high';
  /** True when a body became the question and the cues were withheld. */
  redirected: boolean;
}

export interface EquipmentSubstitution {
  exerciseId: string;
  exerciseName: string;
  alternativeExerciseId: string;
  alternativeName: string;
  reason: string;
}

export interface EquipmentCheckResult {
  equipmentDetected: Equipment[];
  notes: string[];
  substitutions: EquipmentSubstitution[];
  proposalId: string | null;
}

export interface MealCheckResult {
  observations: string[];
  behaviorSuggestions: Array<{ key: string; text: string }>;
}

/** Every media check answers 200; a failure is `ok: false`. */
export type MediaCheckResponse<T> =
  | { ok: true; result: T; storageObjectId: string; invocationId: string }
  | { ok: false; error: { code: string; message: string } };
