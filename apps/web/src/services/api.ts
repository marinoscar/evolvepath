/**
 * Where the API lives.
 *
 * EXPORTED as of #127. The notification SSE client (`services/sse.ts`) opens a
 * raw `fetch` outside `ApiService.request` — it has to, because that method
 * buffers a JSON body and an event stream never ends — and it must resolve its
 * URL against exactly the same base. A second literal `'/api'` there would be
 * a same-origin assumption that silently breaks the day `VITE_API_BASE_URL` is
 * set, in the one code path that fails by going quiet rather than by erroring.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Unwraps the `{ data, meta }` envelope every API response carries.
 *
 * KEYED ON THE KEY'S PRESENCE, not on the value's truthiness. This used to be
 * `body.data ?? body`, which is correct for every payload except the falsy
 * ones — and `GET /me/best-self` answers `{ "data": null }` for a profile that
 * has never been saved, which is a legitimate, documented result and not an
 * absence. `??` fell through on it and handed the caller the whole envelope,
 * so `profile` became `{ data: null, meta: {...} }`: truthy, wrongly shaped,
 * and only visible where something later read a field off it.
 *
 * The same trap waits for any endpoint that answers `0`, `false` or `""`.
 *
 * A response that is not an envelope at all (an error body already handled
 * above, or a bare value) is returned untouched, exactly as before.
 */
function unwrapEnvelope<T>(body: unknown): T {
  if (body !== null && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiService {
  private accessToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { skipAuth = false, ...fetchOptions } = options;

    const headers: HeadersInit = {
      ...fetchOptions.headers,
    };

    // Only set Content-Type for requests with a body (Fastify 5 is strict about this)
    if (fetchOptions.body) {
      (headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    if (!skipAuth && this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers,
      credentials: 'include', // Include cookies for refresh token
    });

    if (response.status === 401 && !skipAuth) {
      // Try to refresh token (only once, avoid infinite loops)
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // Update authorization header with new token and retry ONCE
        const retryHeaders: HeadersInit = {
          'Content-Type': 'application/json',
          ...fetchOptions.headers,
          'Authorization': `Bearer ${this.accessToken}`,
        };

        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...fetchOptions,
          headers: retryHeaders,
          credentials: 'include',
        });

        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({}));
          notifyIfAiKeyRequired(retryResponse.status, error.code);
          throw new ApiError(
            error.message || 'Request failed',
            retryResponse.status,
            error.code,
            error.details,
          );
        }

        if (retryResponse.status === 204) {
          return undefined as T;
        }

        const data = await retryResponse.json();
        return unwrapEnvelope<T>(data);
      }
      throw new ApiError('Unauthorized', 401);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // Before throwing: a 412 AI_KEY_REQUIRED means this tab's idea of the
      // user is stale. See `AI_KEY_REQUIRED_EVENT`.
      notifyIfAiKeyRequired(response.status, error.code);
      throw new ApiError(
        error.message || 'Request failed',
        response.status,
        error.code,
        error.details,
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();
    return unwrapEnvelope<T>(data);
  }

  async refreshToken(): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh
    this.refreshPromise = this.doRefreshToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        this.accessToken = null;
        return false;
      }

      const responseData = await response.json();
      // Unwrap the { data: { accessToken } } structure from TransformInterceptor
      const tokenData = responseData.data ?? responseData;

      // Validate that we actually got a token
      if (!tokenData.accessToken || typeof tokenData.accessToken !== 'string') {
        this.accessToken = null;
        return false;
      }

      this.accessToken = tokenData.accessToken;
      return true;
    } catch {
      this.accessToken = null;
      return false;
    }
  }

  // Generic methods
  get<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

/**
 * The `window` event a 412 `AI_KEY_REQUIRED` dispatches (issue #29, epic #20).
 *
 * The gate (`RequireAiKey`) reads `user.aiKey.configured` from `AuthContext`,
 * which is only as fresh as the last `/auth/me`. A key removed in another tab —
 * or through the API directly — leaves this tab believing it still has one,
 * until the first AI call comes back 412. This event is how the API layer tells
 * `AuthContext` to re-read, so the gate re-evaluates and the redirect happens.
 *
 * AN EVENT RATHER THAN A DIRECT CALL because `services/api.ts` is a plain module
 * with no React context: importing the auth context here would be a cycle
 * (`AuthContext` imports `api`), and passing a callback in would mean every
 * caller of every endpoint remembering to wire it.
 */
export const AI_KEY_REQUIRED_EVENT = 'evolvepath:ai-key-required';

/**
 * The `code` the API sends on a 412 for a caller with no OpenAI key.
 *
 * It survives the error envelope only because `AiKeyRequiredException` opts out
 * of the envelope's `code` rewriting — see the API's
 * `verbatim-error-body.exception.ts`.
 */
export const AI_KEY_REQUIRED_CODE = 'AI_KEY_REQUIRED';

function notifyIfAiKeyRequired(status: number, code: unknown): void {
  if (status !== 412 || code !== AI_KEY_REQUIRED_CODE) return;
  // Guarded for the non-DOM contexts this module is imported into (a Node test
  // runner without jsdom).
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AI_KEY_REQUIRED_EVENT));
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiService();

// Import types
import type {
  PushSubscriptionSummary,
  FamilyMember,
  FamilyMemberInput,
  FamilySummary,
  LintResult,
  MaterializeResult,
  Ritual,
  RitualInput,
  RitualWithUpcoming,
  AllowlistResponse,
  AllowedEmailEntry,
  UsersResponse,
  UserListItem,
  DeviceActivationInfo,
  DeviceAuthorizationResponse,
  PersonalAccessToken,
  PatCreatedResponse,
  PatDurationUnit,
  EmailSettings,
  EmailSettingsInput,
  EmailTestResult,
  AiSettings,
  AiSettingsInput,
  AiPersona,
  AiModelsResult,
  AiTestResult,
  MyAiKeyStatus,
  NotificationEventDef,
  AppNotification,
  NotificationListResponse,
  UnreadCountResponse,
  // EvolvePath product domain (epic #33)
  BestSelfProfile,
  // The Today screen (epic E05)
  CheckInFeel,
  CommitmentCard,
  CompleteCommitmentInput,
  DailyCheckIn,
  DayReflection,
  DecompositionProposal,
  ReflectionQuickOption,
  SkipReason,
  StartContext,
  TodayInsight,
  TodayResponse,
  BestSelfInput,
  Domain,
  DomainMode,
  DomainModeKind,
  Outcome,
  OutcomeInput,
  Plan,
  PlanInput,
  PlanVersion,
  PlanVersionInput,
  PlanVersionSummary,
  Routine,
  RoutineInput,
  Commitment,
  CommitmentDetail,
  CommitmentInput,
  CommitmentStatus,
  TransitionInput,
  TransitionResult,
} from '../types';

// Allowlist API
/**
 * Sort keys `GET /api/allowlist` accepts, mirroring
 * `allowlistQuerySchema.sortBy` (`apps/api/src/allowlist/dto/allowlist-query.dto.ts`).
 */
export type AllowlistSortField = 'email' | 'addedAt' | 'claimedAt';

export async function getAllowlist(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'all' | 'pending' | 'claimed';
  sortBy?: AllowlistSortField;
  sortOrder?: 'asc' | 'desc';
}): Promise<AllowlistResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  return api.get<AllowlistResponse>(`/allowlist?${searchParams}`);
}

export async function addToAllowlist(
  email: string,
  notes?: string,
): Promise<AllowedEmailEntry> {
  return api.post<AllowedEmailEntry>('/allowlist', { email, notes });
}

export async function removeFromAllowlist(id: string): Promise<void> {
  await api.delete<void>(`/allowlist/${id}`);
}

// Users API
/**
 * Sort keys `GET /api/users` accepts, mirroring `userListQuerySchema.sortBy`
 * (`apps/api/src/users/dto/user-list-query.dto.ts`). Typed rather than
 * `string` so a DataTable column declaring `sortable` against a field the
 * endpoint would reject is a compile error, not a 400 at runtime.
 */
export type UserSortField = 'email' | 'createdAt' | 'updatedAt';

export async function getUsers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  isActive?: boolean;
  sortBy?: UserSortField;
  sortOrder?: 'asc' | 'desc';
}): Promise<UsersResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.role) searchParams.set('role', params.role);
  if (params?.isActive !== undefined)
    searchParams.set('isActive', String(params.isActive));
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  return api.get<UsersResponse>(`/users?${searchParams}`);
}

export async function updateUser(
  id: string,
  data: { displayName?: string; isActive?: boolean },
): Promise<UserListItem> {
  return api.patch<UserListItem>(`/users/${id}`, data);
}

export async function updateUserRoles(
  id: string,
  roles: string[],
): Promise<UserListItem> {
  return api.put<UserListItem>(`/users/${id}/roles`, { roles });
}

// Device Activation API
export async function getDeviceActivationInfo(
  userCode: string,
): Promise<DeviceActivationInfo> {
  return api.get<DeviceActivationInfo>(`/auth/device/activate?code=${userCode}`);
}

export async function authorizeDevice(
  userCode: string,
  approve: boolean,
): Promise<DeviceAuthorizationResponse> {
  return api.post<DeviceAuthorizationResponse>('/auth/device/authorize', {
    userCode,
    approve,
  });
}

// Personal Access Tokens API
export async function getPersonalAccessTokens(): Promise<PersonalAccessToken[]> {
  return api.get<PersonalAccessToken[]>('/pat');
}

export async function createPersonalAccessToken(data: {
  name: string;
  durationValue: number;
  durationUnit: PatDurationUnit;
}): Promise<PatCreatedResponse> {
  return api.post<PatCreatedResponse>('/pat', data);
}

export async function revokePersonalAccessToken(id: string): Promise<void> {
  await api.delete<void>(`/pat/${id}`);
}

// Email settings API — issue #124, epic #109.
//
// Three calls, one controller (`system_settings:read` to read,
// `system_settings:write` to save or test), and the ONLY place in the web app
// that names these endpoints. The page and its hook speak in `EmailSettings`
// terms; if the API's routes or field names move, this block plus the types in
// `types/index.ts` are the entire reconciliation surface.
//
// The payloads are FLAT — `sesRegion`, `smtpHost`, `smtpPort` and friends are
// siblings, not members of `ses: {…}` / `smtp: {…}` sub-objects. See the note
// in `types/index.ts`; getting this wrong compiles cleanly and fails only at
// runtime, which is why it is written down in both places.

export async function getEmailSettings(): Promise<EmailSettings> {
  return api.get<EmailSettings>('/email-settings');
}

/**
 * Replace the stored email settings.
 *
 * PUT rather than PATCH because this is one small document edited on one
 * screen: a per-field merge would let a half-saved provider switch (SMTP host
 * written, SES region not) exist as a state nothing in the UI can show. The
 * one field with merge semantics is `smtpPassword`, and those semantics live
 * in the API (blank preserves — see `EmailSettingsInput`), not in a patch
 * document.
 *
 * `expectedVersion` becomes `If-Match`, the same optimistic-concurrency
 * mechanism `useSystemSettings` uses against `/system-settings`, because the
 * API offers it here too and a settings row with a version counter and no
 * caller checking it is a lost-update waiting to happen: two admins on this
 * page, and the second save silently discards the first with nothing on either
 * screen to show it. A mismatch is a 409, which the hook turns into a reload
 * plus a message rather than an overwrite.
 *
 * PASSED THROUGH AS-IS, INCLUDING ZERO. `0` is the API's way of asserting "I
 * believe nothing is stored yet", so the check is `=== undefined` and never a
 * truthiness test — `if (expectedVersion)` would drop the guard on exactly the
 * first save, where two admins configuring a fresh deployment collide.
 */
export async function updateEmailSettings(
  input: EmailSettingsInput,
  expectedVersion?: number,
): Promise<EmailSettings> {
  return api.put<EmailSettings>('/email-settings', input, {
    headers:
      expectedVersion === undefined
        ? undefined
        : { 'If-Match': String(expectedVersion) },
  });
}

/**
 * Send a test message to the CALLER'S OWN address, using the SAVED settings.
 *
 * No recipient parameter, deliberately: a free-text "send to" box on an
 * authenticated admin form is a send-arbitrary-mail endpoint wearing a
 * diagnostic hat (#124's own rejected alternative). The caller's identity is
 * already on the request, so the API resolves the recipient itself.
 *
 * RESOLVES ON FAILURE. A provider that refuses the message still produces a
 * 200 carrying `{ success: false, error }`; only a transport or authorization
 * failure rejects. Callers MUST branch on `result.success`.
 */
export async function sendTestEmail(): Promise<EmailTestResult> {
  return api.post<EmailTestResult>('/email-settings/test');
}

// -----------------------------------------------------------------------------
// AI settings (epic #20, issue #24)
// -----------------------------------------------------------------------------

/** `GET /api/ai-settings` — the configuration plus the masked platform-key status. */
export async function getAiSettings(): Promise<AiSettings> {
  return api.get<AiSettings>('/ai-settings');
}

/**
 * Replace the stored AI settings.
 *
 * PUT rather than PATCH, and `expectedVersion` becomes `If-Match`, for exactly
 * the reasons `updateEmailSettings` documents above: one small document edited
 * on one screen, and a version counter with no caller checking it is a
 * lost-update waiting to happen. `0` is passed through as-is — it is the API's
 * way of asserting "I believe nothing is stored yet", so the check is
 * `=== undefined` and never a truthiness test.
 */
export async function updateAiSettings(
  input: AiSettingsInput,
  expectedVersion?: number,
): Promise<AiSettings> {
  return api.put<AiSettings>('/ai-settings', input, {
    headers:
      expectedVersion === undefined
        ? undefined
        : { 'If-Match': String(expectedVersion) },
  });
}

/**
 * `GET /api/ai-settings/personas` — the personas a model can be assigned to.
 *
 * The web app keeps NO copy of this list; it renders the server's answer, the
 * same rule `getNotificationEvents` follows. The response is ordered and the
 * order is the registry's own — do not sort it.
 */
export async function getAiPersonas(): Promise<AiPersona[]> {
  return api.get<AiPersona[]>('/ai-settings/personas');
}

/**
 * `GET /api/ai-settings/models` — the selectable catalog, filtered server-side
 * to GPT 5.4 or newer.
 *
 * RESOLVES ON FAILURE. The endpoint answers 200 with `{ success: false, error }`
 * when the provider could not be reached; it rejects only when the call itself
 * fails. Callers MUST branch on `result.success`.
 *
 * `refresh` bypasses the API's 5-minute cache and is throttled to 10 per minute
 * per user — a 429 rejects, and the hook turns it into `models.error`.
 */
export async function getAiModels(refresh = false): Promise<AiModelsResult> {
  return api.get<AiModelsResult>(
    refresh ? '/ai-settings/models?refresh=true' : '/ai-settings/models',
  );
}

/**
 * `POST /api/ai-settings/test` — probe the platform key.
 *
 * RESOLVES ON FAILURE, like the email test: a refused connection is a 200 with
 * `{ success: false, error }` and is the diagnosis the button exists to
 * produce. Branch on `result.success`, never on the promise settling.
 */
export async function testAiConnection(): Promise<AiTestResult> {
  return api.post<AiTestResult>('/ai-settings/test');
}

// -----------------------------------------------------------------------------
// The caller's own OpenAI key (epic #20, issue #25)
// -----------------------------------------------------------------------------
//
// No user id in any path: these address the CALLER'S key by construction, which
// is why they need authentication and no permission at all.

/** `GET /api/me/ai-key` — status, last test, and what the platform is missing. */
export async function getMyAiKey(): Promise<MyAiKeyStatus> {
  return api.get<MyAiKeyStatus>('/me/ai-key');
}

/**
 * `PUT /api/me/ai-key` — save or replace the caller's key.
 *
 * UNLIKE THE PLATFORM KEY, THERE IS NO BLANK-PRESERVES HERE. This endpoint's
 * only job is to set a key; there is no surrounding form whose other fields a
 * user might be editing, so an empty submission is a mistake and the API says
 * so with a 400 rather than silently succeeding.
 */
export async function setMyAiKey(apiKey: string): Promise<MyAiKeyStatus> {
  return api.put<MyAiKeyStatus>('/me/ai-key', { apiKey });
}

/** `DELETE /api/me/ai-key` — idempotent; removing a key that is not there succeeds. */
export async function deleteMyAiKey(): Promise<void> {
  await api.delete<void>('/me/ai-key');
}

/**
 * `POST /api/me/ai-key/test` — probe the caller's own key.
 *
 * RESOLVES ON FAILURE, like every other test endpoint in this app: a refused
 * connection is a 200 with `{ success: false, error }` and IS the diagnosis.
 * Branch on `result.success`, never on the promise settling.
 */
export async function testMyAiKey(): Promise<AiTestResult> {
  return api.post<AiTestResult>('/me/ai-key/test');
}

/**
 * The notification event registry — `GET /api/notifications/events` (#124).
 *
 * AUTHENTICATED, NOT ADMIN-GATED. Every signed-in user reads this; it is what
 * `/settings/notifications` renders its matrix against, and that page belongs
 * to every role. A `system_settings:read` reflex here would leave a Viewer with
 * a preferences page and no rows in it.
 *
 * THE WEB APP DOES NOT KEEP A COPY OF THIS LIST, deliberately. `mandatory` is a
 * security flag, and a second declaration of a security flag is a second place
 * for it to be wrong; a duplicated registry would also break epic #109's
 * headline promise that adding a notification costs ONE registry entry. The
 * consequence is that the preferences page renders whatever the server serves,
 * including events added after this build shipped.
 *
 * The response is ORDERED and the order is meaningful — it is the order the
 * preferences UI should render. Do not sort it.
 */
export async function getNotificationEvents(): Promise<NotificationEventDef[]> {
  return api.get<NotificationEventDef[]>('/notifications/events');
}

// Notification centre API — issue #127, epic #109.
//
// The four REST calls behind the bell. The fifth endpoint of this controller —
// `GET /api/notifications/stream` — is deliberately NOT here: it is an
// unbounded `text/event-stream` and `ApiService.request` awaits `response.json()`,
// which on a stream that never ends never resolves. It lives in
// `services/notificationStream.ts` on top of the fetch-based SSE client.
//
// NOT ONE OF THESE CALLS NAMES A USER, in a path, a query or a body. Every one
// operates on the authenticated caller's own rows, resolved server-side from
// the JWT (`@CurrentUser('id')`). There is no `?userId=` to add here, and
// adding one would not work: the API has no parameter for it, by design — see
// the header of `apps/api/src/notifications/notifications.controller.ts`.

/**
 * A page of the caller's notifications, newest first.
 *
 * THE DURABLE SURFACE. This is correct whether or not the user ever granted
 * browser-notification permission and whether or not the SSE stream was
 * connected when a notification was raised, which is why the centre is built on
 * it and the native toast is decoration on top.
 *
 * `unreadOnly` is sent as the STRING `'true'`/`'false'`, matching the API's
 * schema exactly. It is an explicit enum there rather than a coerced boolean
 * because `z.coerce.boolean()` follows JS truthiness and would turn the string
 * `'false'` into `true`, inverting the filter — so the spelling here is
 * load-bearing rather than stylistic.
 */
export async function getNotifications(params?: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}): Promise<NotificationListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  // `!== undefined`, not truthiness: `false` is a meaningful value to send.
  if (params?.unreadOnly !== undefined) {
    searchParams.set('unreadOnly', params.unreadOnly ? 'true' : 'false');
  }

  return api.get<NotificationListResponse>(`/notifications?${searchParams}`);
}

/**
 * The badge number.
 *
 * A DEDICATED ENDPOINT, not something counted out of a page of
 * `getNotifications`: a count taken from a page silently caps at `pageSize`, so
 * a user with 30 unread would see "20" and never learn otherwise. Call it on
 * mount and again on every SSE (re)connect.
 */
export async function getUnreadNotificationCount(): Promise<UnreadCountResponse> {
  return api.get<UnreadCountResponse>('/notifications/unread-count');
}

/**
 * Mark one notification read.
 *
 * RETURNS THE NEW UNREAD COUNT, which is the whole reason this is worth a round
 * trip: the caller already holds the row it just marked, so the count is the
 * only thing it cannot compute for itself. DO NOT follow this with a call to
 * `getUnreadNotificationCount` — that is the two-round-trip shape the API was
 * built to avoid.
 *
 * Idempotent server-side; marking an already-read notification succeeds and
 * leaves the original `readAt` alone. A 404 means "no such notification FOR
 * THIS USER" — an id belonging to somebody else is indistinguishable from one
 * that does not exist, deliberately, so the endpoint cannot be used to probe
 * for valid ids.
 */
export async function markNotificationRead(id: string): Promise<UnreadCountResponse> {
  return api.post<UnreadCountResponse>(`/notifications/${id}/read`);
}

/**
 * Clear the badge in one call, returning the resulting count.
 *
 * The count is REPORTED, not assumed to be zero: a notification arriving
 * between the update and the count is reflected honestly rather than hidden
 * behind a hardcoded `0`. Callers must use the returned number and never
 * `setUnreadCount(0)`.
 */
export async function markAllNotificationsRead(): Promise<UnreadCountResponse> {
  return api.post<UnreadCountResponse>('/notifications/read-all');
}

// -----------------------------------------------------------------------------
// Web push (#64, epic E12)
// -----------------------------------------------------------------------------

/**
 * The VAPID public key, or `null` when this deployment has no push configured.
 *
 * `null` is a VALID ANSWER, not an error: the push channel is simply inactive
 * and the user still gets the inbox row and the live SSE update. The settings
 * page renders a different sentence for it (`unconfigured`), because "turn this
 * on" would be advice the user cannot act on.
 */
export async function getPushPublicKey(): Promise<{ publicKey: string | null }> {
  return api.get<{ publicKey: string | null }>('/notifications/push/public-key');
}

export async function getPushSubscriptions(): Promise<{
  items: PushSubscriptionSummary[];
}> {
  return api.get<{ items: PushSubscriptionSummary[] }>('/notifications/push-subscriptions');
}

/**
 * Register this browser. The body is `PushSubscription.toJSON()` plus a UA
 * string, and the server upserts on the endpoint.
 */
export async function createPushSubscription(body: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}): Promise<{ id: string }> {
  return api.post<{ id: string }>('/notifications/push-subscriptions', body);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  // A DELETE with a body, which is unusual but correct here: the endpoint is a
  // 2 KB opaque URL, and putting one in a query string would land it in access
  // logs and browser history — the two places a bearer capability for somebody's
  // device should never be.
  await api.delete<void>('/notifications/push-subscriptions', {
    body: JSON.stringify({ endpoint }),
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Re-exported for consumers that only import from this module. */
export type { AppNotification };

// =============================================================================
// EvolvePath product domain (epic #33)
// =============================================================================
//
// The ONLY place in the web app that names these endpoints. Everything above
// this line speaks in domain terms; if a route or a field moves, this block
// plus the types in `types/index.ts` are the entire reconciliation surface.
//
// No function here makes an authorization decision. An id belonging to another
// user answers 404, identical to an id that never existed, and that answer is
// the truth — there is deliberately nothing client-side to disagree with it.
// =============================================================================

// --- Best Self --------------------------------------------------------------

/** `null` until the profile has been saved once — an empty card, not an error. */
export async function getBestSelf(): Promise<BestSelfProfile | null> {
  return api.get<BestSelfProfile | null>('/me/best-self');
}

/** A PUT: omitted fields are cleared. There is no PATCH by design. */
export async function putBestSelf(input: BestSelfInput): Promise<BestSelfProfile> {
  return api.put<BestSelfProfile>('/me/best-self', input);
}

// --- Outcomes ---------------------------------------------------------------

export async function getOutcomes(params?: {
  domain?: Domain;
  includeArchived?: boolean;
}): Promise<Outcome[]> {
  const query = new URLSearchParams();
  if (params?.domain) query.set('domain', params.domain);
  if (params?.includeArchived) query.set('includeArchived', 'true');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return api.get<Outcome[]>(`/outcomes${suffix}`);
}

export async function createOutcome(input: OutcomeInput): Promise<Outcome> {
  return api.post<Outcome>('/outcomes', input);
}

export async function getOutcome(id: string): Promise<Outcome> {
  return api.get<Outcome>(`/outcomes/${id}`);
}

export async function updateOutcome(id: string, patch: OutcomeInput): Promise<Outcome> {
  return api.patch<Outcome>(`/outcomes/${id}`, patch);
}

/** Idempotent: archiving an already-archived outcome succeeds and changes nothing. */
export async function archiveOutcome(id: string): Promise<Outcome> {
  return api.post<Outcome>(`/outcomes/${id}/archive`, {});
}

// --- Domain modes -----------------------------------------------------------

/** Always three entries, in WORK/FAMILY/HEALTH order, synthesised where unset. */
export async function getDomainModes(): Promise<DomainMode[]> {
  return api.get<DomainMode[]>('/me/domain-modes');
}

export async function setDomainMode(
  domain: Domain,
  body: { mode: DomainModeKind; reason?: string | null },
): Promise<DomainMode> {
  return api.put<DomainMode>(`/me/domain-modes/${domain}`, body);
}

// --- Plans and versions -----------------------------------------------------

export async function getPlansForOutcome(outcomeId: string): Promise<Plan[]> {
  return api.get<Plan[]>(`/outcomes/${outcomeId}/plans`);
}

export async function createPlan(outcomeId: string, body: PlanInput): Promise<Plan> {
  return api.post<Plan>(`/outcomes/${outcomeId}/plans`, body);
}

export async function getPlanVersions(planId: string): Promise<PlanVersionSummary[]> {
  return api.get<PlanVersionSummary[]>(`/plans/${planId}/versions`);
}

/** `version` is the integer the user sees ("v2"), not the version's UUID. */
export async function getPlanVersion(planId: string, version: number): Promise<PlanVersion> {
  return api.get<PlanVersion>(`/plans/${planId}/versions/${version}`);
}

export async function createPlanVersion(
  planId: string,
  body: PlanVersionInput,
): Promise<PlanVersion> {
  return api.post<PlanVersion>(`/plans/${planId}/versions`, body);
}

export async function activatePlanVersion(
  planId: string,
  version: number,
): Promise<PlanVersion> {
  return api.post<PlanVersion>(`/plans/${planId}/versions/${version}/activate`, {});
}

export async function rejectPlanVersion(
  planId: string,
  version: number,
  reason?: string,
): Promise<PlanVersion> {
  return api.post<PlanVersion>(`/plans/${planId}/versions/${version}/reject`, { reason });
}

// --- Routines ---------------------------------------------------------------

export async function getRoutines(
  planVersionId: string,
  includeInactive = true,
): Promise<Routine[]> {
  const query = new URLSearchParams({ planVersionId });
  // The editor shows deactivated routines with a toggle, so the default here
  // is the opposite of the API's — a list that silently hid them would make
  // "reactivate this" unreachable.
  if (includeInactive) query.set('includeInactive', 'true');
  return api.get<Routine[]>(`/routines?${query.toString()}`);
}

export async function createRoutine(input: RoutineInput): Promise<Routine> {
  return api.post<Routine>('/routines', input);
}

export async function updateRoutine(id: string, patch: RoutineInput): Promise<Routine> {
  return api.patch<Routine>(`/routines/${id}`, patch);
}

export async function deleteRoutine(id: string): Promise<void> {
  await api.delete<void>(`/routines/${id}`);
}

// --- Commitments ------------------------------------------------------------

export async function getCommitments(params: {
  /** ISO 8601 with offset. Required by the API; the window is capped at 62 days. */
  from: string;
  to: string;
  outcomeId?: string;
  domain?: Domain;
  status?: CommitmentStatus[];
}): Promise<Commitment[]> {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.outcomeId) query.set('outcomeId', params.outcomeId);
  if (params.domain) query.set('domain', params.domain);
  // CSV, not repeated keys — see the API's query DTO for why.
  if (params.status?.length) query.set('status', params.status.join(','));
  return api.get<Commitment[]>(`/commitments?${query.toString()}`);
}

export async function createCommitment(input: CommitmentInput): Promise<Commitment> {
  return api.post<Commitment>('/commitments', input);
}

/** Edits a commitment. `domain` and the foreign ids are immutable server-side. */
export async function updateCommitment(
  id: string,
  patch: Partial<CommitmentInput>,
): Promise<Commitment> {
  return api.patch<Commitment>(`/commitments/${id}`, patch);
}

export async function getCommitment(id: string): Promise<CommitmentDetail> {
  return api.get<CommitmentDetail>(`/commitments/${id}`);
}

/**
 * The only way a commitment's status changes.
 *
 * A move the API's matrix forbids answers 409 with
 * `details.reason === 'INVALID_TRANSITION'`, which the caller uses to tell
 * "the world moved under you" apart from every other conflict.
 */
export async function transitionCommitment(
  id: string,
  body: TransitionInput,
): Promise<TransitionResult> {
  return api.post<TransitionResult>(`/commitments/${id}/transition`, body);
}

// --- Today (epic E05) -------------------------------------------------------

/**
 * The day. Deterministic and AI-free on the server, so this call succeeds even
 * when the provider is down — the coach's sentence is a separate request below.
 */
export async function getToday(): Promise<TodayResponse> {
  return api.get<TodayResponse>('/today');
}

/**
 * The coach's sentence. Always 200: `source: 'template'` means the coach was
 * unavailable, which is a caption on the card and not an error to handle.
 */
export async function getTodayInsight(): Promise<TodayInsight> {
  return api.get<TodayInsight>('/today/insight');
}

export async function getCheckIn(): Promise<DailyCheckIn | null> {
  return api.get<DailyCheckIn | null>('/today/check-in');
}

export async function postCheckIn(feel: CheckInFeel): Promise<DailyCheckIn> {
  return api.post<DailyCheckIn>('/today/check-in', { feel });
}

export async function getDayReflection(): Promise<DayReflection | null> {
  return api.get<DayReflection | null>('/today/reflection');
}

export async function postDayReflection(input: {
  quickOption: ReflectionQuickOption;
  text?: string | null;
}): Promise<DayReflection> {
  return api.post<DayReflection>('/today/reflection', input);
}

// --- Commitment actions (epic E05) ------------------------------------------
//
// Every one of these returns a `CommitmentCard`, so a caller replaces the row it
// acted on with the server's own answer rather than reasoning about what the
// action implied.

/**
 * What the Start screen reads.
 *
 * Deliberately not `getCommitment`, which returns the RECORD — every column plus
 * evidence and reflections. A screen that read one shape and then received a
 * `CommitmentCard` back from every action it fires would drift from the API one
 * field at a time.
 */
export async function getCommitmentCard(id: string): Promise<StartContext> {
  return api.get<StartContext>(`/commitments/${id}/actions`);
}

export async function startCommitment(
  id: string,
  body: { minutes?: number | null } = {},
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/start`, body);
}

export async function pauseCommitment(id: string): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/pause`, {});
}

export async function continueCommitment(
  id: string,
  body: { extraMinutes?: number | null } = {},
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/continue`, body);
}

export async function completeCommitment(
  id: string,
  body: CompleteCommitmentInput = {},
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/complete`, body);
}

export async function partialCommitment(
  id: string,
  body: CompleteCommitmentInput = {},
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/partial`, body);
}

export async function useCommitmentFallback(
  id: string,
  version: 'short' | 'minimum',
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/fallback`, { version });
}

/**
 * Moving a commitment CLOSES it and returns a NEW one — `RESCHEDULED` is
 * terminal. Callers must use the returned card's id from here on.
 */
export async function rescheduleCommitment(
  id: string,
  body: { scheduledStart: string; scheduledEnd?: string | null },
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/reschedule`, body);
}

export async function skipCommitment(
  id: string,
  body: { reason: SkipReason; text?: string | null },
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/skip`, body);
}

/** Asks the coach for smaller steps. Writes nothing until `applyDecomposition`. */
export async function proposeDecomposition(
  id: string,
  body: { hint?: string | null } = {},
): Promise<DecompositionProposal> {
  return api.post<DecompositionProposal>(`/commitments/${id}/actions/decompose`, body);
}

/** Creates a new commitment from the proposal's first step. Returns its card. */
export async function applyDecomposition(
  id: string,
  proposal: DecompositionProposal,
): Promise<CommitmentCard> {
  return api.post<CommitmentCard>(`/commitments/${id}/actions/decompose/apply`, proposal);
}

// --- Family (epic E08) ------------------------------------------------------

export async function getFamilyMembers(): Promise<FamilyMember[]> {
  return api.get<FamilyMember[]>('/family/members');
}

export async function createFamilyMember(body: FamilyMemberInput): Promise<FamilyMember> {
  return api.post<FamilyMember>('/family/members', body);
}

export async function updateFamilyMember(
  id: string,
  body: Partial<FamilyMemberInput>,
): Promise<FamilyMember> {
  return api.patch<FamilyMember>(`/family/members/${id}`, body);
}

export async function deleteFamilyMember(id: string): Promise<void> {
  await api.delete(`/family/members/${id}`);
}

export async function getRituals(params?: { active?: boolean }): Promise<Ritual[]> {
  const suffix = params?.active === undefined ? '' : `?active=${params.active}`;
  return api.get<Ritual[]>(`/family/rituals${suffix}`);
}

/** The ritual plus the next seven days of its occurrences, as commitment cards. */
export async function getRitual(id: string): Promise<RitualWithUpcoming> {
  return api.get<RitualWithUpcoming>(`/family/rituals/${id}`);
}

/**
 * 400 `BEHAVIOUR_TARGETS_OTHER_PERSON` when the title describes another
 * person's feelings or conduct. The `ApiError`'s `details` carries `match`.
 */
export async function createRitual(body: RitualInput): Promise<Ritual> {
  return api.post<Ritual>('/family/rituals', body);
}

export async function updateRitual(id: string, body: RitualInput): Promise<Ritual> {
  return api.patch<Ritual>(`/family/rituals/${id}`, body);
}

export async function deleteRitual(id: string): Promise<void> {
  await api.delete(`/family/rituals/${id}`);
}

/** Idempotent: a repeat is `skipped`, never a duplicate occurrence. */
export async function materializeRitual(id: string): Promise<MaterializeResult> {
  return api.post<MaterializeResult>(`/family/rituals/${id}/materialize`, {});
}

/**
 * Always 200 — a check, not a refusal.
 *
 * The verdict is deterministic; `suggestion` is `null` with `source: 'none'`
 * whenever the coach is unavailable, so the caller renders the error with or
 * without the rewrite button and never branches on a status code.
 */
export async function lintFamilyTitle(title: string): Promise<LintResult> {
  return api.post<LintResult>('/family/lint', { title });
}

export async function getFamilySummary(params?: {
  weekStart?: string;
  weeks?: number;
}): Promise<FamilySummary> {
  const query = new URLSearchParams();
  if (params?.weekStart) query.set('weekStart', params.weekStart);
  if (params?.weeks !== undefined) query.set('weeks', String(params.weeks));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return api.get<FamilySummary>(`/family/summary${suffix}`);
}
