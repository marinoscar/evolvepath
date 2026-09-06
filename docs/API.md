# API Reference

## Base URL

- **Development**: http://localhost:3535/api
- **Production**: https://yourdomain.com/api

## Authentication

All endpoints require JWT Bearer token authentication unless explicitly marked as **Public**.

**Authorization Header:**
```
Authorization: Bearer <access_token>
```

Access tokens are short-lived (15 minutes by default). Use the refresh token flow to obtain new access tokens.

## Response Format

### Success Response

```json
{
  "data": <response_data>,
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Response

```json
{
  "statusCode": 400,
  "message": "Human readable error message",
  "error": "BadRequest"
}
```

For validation errors:
```json
{
  "statusCode": 400,
  "message": ["Field validation error 1", "Field validation error 2"],
  "error": "BadRequest"
}
```

## Pagination

Endpoints returning lists support pagination with the following query parameters:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `page` | number | 1 | - | Page number (1-indexed) |
| `pageSize` | number | 20 | 100 | Items per page |

**Paginated Response Format:**
```json
{
  "data": [...],
  "meta": {
    "total": 150,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

---

### Product resources and ownership

Every EvolvePath resource — outcomes, plans, plan versions, routines,
commitments, evidence, reflections — belongs to exactly one user, and the API
answers **404 for a resource that is not yours**, byte-identical to one that
never existed.

**This is deliberate, and it is not a 403.** A 403 confirms that a guessed id
is real; a 404 tells an attacker nothing they did not already know. The two
responses come from one code path so they cannot diverge, and no client is
expected to distinguish them — the web app renders a "not found" screen for
both rather than redirecting, because a redirect would make a mistyped URL look
like a working one.

The corollary: **no client makes an authorization decision** about these
resources. There is nothing to check before requesting one, and nothing a stale
client could get wrong.

See [`docs/specs/domain-model.md`](specs/domain-model.md) for the full contract.

---

## Endpoints

### Authentication

#### GET /auth/providers
**Public endpoint** - List enabled OAuth providers.

**Response:**
```json
{
  "data": {
    "providers": [
      {
        "name": "google",
        "enabled": true
      }
    ]
  }
}
```

---

#### GET /auth/google
**Public endpoint** - Initiate Google OAuth flow. Redirects to Google consent screen.

**Response:** HTTP 302 redirect to Google

---

#### GET /auth/google/callback
**Public endpoint** - OAuth callback handler (called by Google).

**Query Parameters:**
- `code` (string) - Authorization code from Google
- `state` (string, optional) - CSRF protection state

**Response:** HTTP 302 redirect to frontend with access token in query parameter
- Sets HttpOnly refresh token cookie
- Redirects to `/auth/callback?accessToken=<token>`

**Error Cases:**
- Email not in allowlist → Redirects to `/auth/error?error=not_authorized`
- OAuth failure → Redirects to `/auth/error?error=oauth_failed`

---

#### GET /auth/me
**Requires Authentication** - Get current user profile.

`aiKey` and `onboarding` ride on this response rather than on requests of their
own: the web app gates its shell on both before it renders, and a second call on
boot would be a waterfall in front of every page load. `onboarding.completed` is
`false` for an account that has never onboarded, and reading it creates no
`user_profiles` row.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "isActive": true,
  "roles": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "Administrator with full access"
    }
  ],
  "permissions": ["users:read", "users:write", "system_settings:read", ...],
  "aiKey": { "configured": true, "hint": "••••abcd" },
  "onboarding": { "completed": false }
}
```

---

#### POST /auth/refresh
**Public endpoint** - Refresh access token using refresh token cookie.

**Request:** No body required (uses HttpOnly cookie)

**Response:**
```json
{
  "accessToken": "new_jwt_access_token",
  "expiresIn": 900
}
```

Sets new refresh token in HttpOnly cookie (token rotation).

**Error Cases:**
- 401 Unauthorized - Missing or invalid refresh token
- 403 Forbidden - User is disabled

---

#### POST /auth/logout
**Requires Authentication** - Logout and revoke refresh token.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes refresh token in database

---

#### POST /auth/logout-all
**Requires Authentication** - Logout from all devices and revoke all refresh tokens.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes ALL refresh tokens for the current user across all devices

**Use Case:** Security feature to force re-authentication on all sessions (e.g., after password change or suspected compromise).

---

### Device Authorization (RFC 8628)

The Device Authorization Flow enables input-constrained devices (CLI tools, IoT devices, Smart TVs) to obtain user authorization. See [DEVICE-AUTH.md](DEVICE-AUTH.md) for comprehensive guide and integration examples.

#### POST /auth/device/code
**Public endpoint** - Generate device code pair to initiate device authorization flow.

**Request Body:**
```json
{
  "clientInfo": {
    "name": "My CLI Tool",
    "version": "1.0.0",
    "platform": "linux"
  }
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientInfo` | object | No | Optional metadata about client device |
| `clientInfo.name` | string | No | Application name |
| `clientInfo.version` | string | No | Application version |
| `clientInfo.platform` | string | No | Platform identifier |

**Response:**
```json
{
  "data": {
    "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4",
    "userCode": "ABCD-1234",
    "verificationUri": "http://localhost:3535/device",
    "verificationUriComplete": "http://localhost:3535/device?code=ABCD-1234",
    "expiresIn": 900,
    "interval": 5
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `deviceCode` | string | Opaque code for device polling (keep secret) |
| `userCode` | string | Human-readable code for user entry (XXXX-XXXX format) |
| `verificationUri` | string | URL where user should authorize |
| `verificationUriComplete` | string | URL with user code pre-filled |
| `expiresIn` | number | Code lifetime in seconds (default: 900) |
| `interval` | number | Minimum polling interval in seconds (default: 5) |

---

#### POST /auth/device/token
**Public endpoint** - Poll for authorization status and obtain tokens when approved.

**Request Body:**
```json
{
  "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4"
}
```

**Response (200 OK - Authorized):**
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

**Error Responses (400 Bad Request):**

While authorization is pending:
```json
{
  "error": "authorization_pending",
  "error_description": "User has not yet authorized this device"
}
```

Device polling too frequently:
```json
{
  "error": "slow_down",
  "error_description": "Polling too frequently. Please slow down."
}
```

Code has expired:
```json
{
  "error": "expired_token",
  "error_description": "The device code has expired"
}
```

User denied authorization:
```json
{
  "error": "access_denied",
  "error_description": "User denied the authorization request"
}
```

**Error Response (401 Unauthorized):**

Invalid device code:
```json
{
  "error": "invalid_grant",
  "error_description": "Invalid device code"
}
```

**Usage:**
1. Device requests code from `/auth/device/code`
2. Device displays `userCode` and `verificationUri` to user
3. Device polls this endpoint every `interval` seconds
4. User visits verification page and approves device
5. Polling returns tokens when approved

---

#### GET /auth/device/activate
**Requires Authentication** - Get activation page information and validate user code.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | No | User verification code to validate |

**Request (No Code):**
```http
GET /auth/device/activate
Authorization: Bearer <token>
```

**Response (No Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:3535/device"
  }
}
```

**Request (With Code):**
```http
GET /auth/device/activate?code=ABCD-1234
Authorization: Bearer <token>
```

**Response (With Valid Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:3535/device",
    "userCode": "ABCD-1234",
    "clientInfo": {
      "name": "My CLI Tool",
      "version": "1.0.0",
      "platform": "linux"
    },
    "expiresAt": "2024-01-01T12:15:00.000Z"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### POST /auth/device/authorize
**Requires Authentication** - Approve or deny device authorization request.

**Request Body:**
```json
{
  "userCode": "ABCD-1234",
  "approve": true
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userCode` | string | Yes | User code from the device |
| `approve` | boolean | Yes | true to approve, false to deny |

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device authorized successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### GET /auth/device/sessions
**Requires Authentication** - List current user's approved device sessions.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | number | No | 1 | Page number |
| `limit` | number | No | 10 | Items per page |

**Response:**
```json
{
  "data": {
    "sessions": [
      {
        "id": "uuid-1234",
        "userCode": "ABCD-1234",
        "status": "approved",
        "clientInfo": {
          "name": "My CLI Tool",
          "version": "1.0.0",
          "platform": "linux"
        },
        "createdAt": "2024-01-01T12:00:00.000Z",
        "expiresAt": "2024-01-01T12:15:00.000Z"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 10
  }
}
```

**Use Case:** View all devices that have been authorized to access the account.

---

#### DELETE /auth/device/sessions/:id
**Requires Authentication** - Revoke a specific device session.

**Parameters:**
- `id` (UUID) - Session ID to revoke

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device session revoked successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Session not found or doesn't belong to current user

**Use Case:** Revoke access for lost or compromised devices.

---

### Test Authentication (Development/Test Only)

**Security Notice:** These endpoints are completely disabled in production. They exist solely to enable automated E2E testing without requiring real OAuth credentials.

#### POST /auth/test/login
**Development/Test Only** - Authenticate as a test user without OAuth.

**Availability:** Only when `NODE_ENV !== 'production'`

**Request Body:**
```json
{
  "email": "test@test.local",
  "role": "admin",
  "displayName": "Test Admin"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Email address for test user |
| `role` | enum | No | Role to assign: `admin`, `contributor`, `viewer` (default: `viewer`) |
| `displayName` | string | No | Display name for the user |

**Response:** HTTP 302 redirect to `/auth/callback?token=<accessToken>&expiresIn=900`
- Sets HttpOnly refresh token cookie (same as OAuth flow)
- Creates user if not exists, assigns specified role

**Error Cases:**
- 403 Forbidden - Endpoint disabled (production environment)
- 400 Bad Request - Invalid email or role

**Use Case:** Playwright E2E tests use this endpoint to authenticate without Google OAuth.

---

#### POST /auth/test/run-job

Runs a background job synchronously and returns its counts. Non-production only,
and `@Auth()` — the job acts on real data across all users, so it needs a caller.

**Request:**

```json
{ "job": "coaching-notifications", "now": "2026-09-08T18:00:00.000Z" }
```

```json
{ "job": "comeback", "email": "momentum@test.local" }
```

`now` simulates the clock. Every rule the coaching engine enforces is about time
("starts in twenty minutes", "inside quiet hours", "already sent today"), so a
test that could only run at the real `now` would have to seed data relative to
the wall clock and then wait. This runs **the same `runOnce` the cron calls**,
not a test double of it.

**Response 201:**

```json
{ "data": { "scanned": 1, "sent": 1, "suppressed": 0, "skipped": false } }
```

`skipped: true` means another run was already in progress and this one did
nothing.

`comeback` (epic E11) runs the inactivity sweep for **one named user** rather
than everybody: a suite asserting on one user's offer must not race with the
same job writing offers for every other seeded account. Its response is
`{ job, closedCount, trigger, comebackState }`.

Later epics add their jobs to the same enum rather than adding a second route.

---

#### POST /auth/test/simulate-idle

Makes a user look as though they went quiet, so the comeback loop (epic E11) can
be driven in a second instead of over four days. Non-production only, and
`@Public()` like `login` above — it names the user by email, so an e2e can call
it before it has a token.

**Request:**

```json
{ "email": "momentum@test.local", "idleDays": 4 }
```

**Response 201:**

```json
{ "data": { "userId": "9c1…", "shiftedCommitments": 12, "shiftedEvidence": 7, "lastActiveAt": "2026-09-02T18:00:00.000Z" } }
```

**Why shift data rather than travel in time.** Every rule the comeback loop
enforces is about elapsed time — three days of silence, four misses in a week,
scheduled before the start of local today. A global clock seam would have to
reach every service the sweep touches, and a test that moved it would be
exercising a code path production never runs. Moving the user's own rows
backwards instead — `last_active_at`, every commitment timestamp and every
evidence timestamp, all by the same interval, so relative distances survive —
keeps the sweep, the detector and the momentum engine running against the real
clock, which is what the suite is meant to prove works.

`idleDays` is 1–60. An unknown email is a **404**, not a silent no-op.

### Users

**All user endpoints require Admin role (`users:read` or `users:write` permissions)**

#### GET /users
List all users with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email or display name |
| `isActive` | boolean | - | Filter by active status |
| `role` | string | - | Filter by role name |
| `sortBy` | enum | `createdAt` | Sort field: `email`, `createdAt`, `updatedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "displayName": "John Doe",
      "profileImageUrl": "https://...",
      "providerDisplayName": "John Doe",
      "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "roles": [
        {
          "id": "uuid",
          "name": "contributor"
        }
      ]
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available from OAuth provider.

---

#### GET /users/:id
Get user by ID.

**Parameters:**
- `id` (UUID) - User ID

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "providerDisplayName": "John Doe",
  "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "roles": [
    {
      "id": "uuid",
      "name": "contributor",
      "description": "Standard user capabilities"
    }
  ],
  "identities": [
    {
      "provider": "google",
      "providerEmail": "user@example.com"
    }
  ]
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available from OAuth provider.

**Error Cases:**
- 404 Not Found - User not found

---

#### PATCH /users/:id
Update user properties (activation status, display name).

**Requires:** `users:write` permission

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "isActive": false,
  "displayName": "New Name"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `isActive` | boolean | No | Activate or deactivate user |
| `displayName` | string | No | Update user's display name |

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "New Name",
  "isActive": false,
  "roles": [
    {
      "id": "uuid",
      "name": "viewer"
    }
  ]
}
```

**Error Cases:**
- 404 Not Found - User not found

---

#### PUT /users/:id/roles
Update user roles (replaces all current roles).

**Requires:** `rbac:manage` permission

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "roleNames": ["admin", "contributor"]
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `roleNames` | string[] | Yes | Array of role names to assign (min: 1) |

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "isActive": true,
  "roles": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "Administrator with full access"
    },
    {
      "id": "uuid",
      "name": "contributor",
      "description": "Standard user capabilities"
    }
  ]
}
```

**Validation Rules:**
- Cannot remove own admin role (prevents accidental lockout)
- At least one role must be assigned
- Role names must exist in the system

**Error Cases:**
- 400 Bad Request - Invalid role names, empty array, or attempting to remove own admin role
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Missing `rbac:manage` permission
- 404 Not Found - User not found

---

### Allowlist

**All allowlist endpoints require Admin role (`allowlist:read` or `allowlist:write` permissions)**

The allowlist restricts application access to pre-authorized email addresses. Users must have their email in the allowlist before they can complete OAuth login.

#### GET /allowlist
List allowlisted emails with pagination, filtering, and sorting.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email |
| `status` | enum | `all` | Filter by status: `all`, `pending`, `claimed` |
| `sortBy` | enum | `addedAt` | Sort by: `email`, `addedAt`, `claimedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "addedBy": {
        "id": "uuid",
        "email": "admin@example.com"
      },
      "addedAt": "2024-01-01T00:00:00.000Z",
      "claimedBy": {
        "id": "uuid",
        "email": "user@example.com",
        "displayName": "John Doe"
      },
      "claimedAt": "2024-01-02T00:00:00.000Z",
      "notes": "New team member"
    },
    {
      "id": "uuid",
      "email": "pending@example.com",
      "addedBy": {
        "id": "uuid",
        "email": "admin@example.com"
      },
      "addedAt": "2024-01-03T00:00:00.000Z",
      "claimedBy": null,
      "claimedAt": null,
      "notes": null
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`). `claimedBy` object contains `id`, `email`, and `displayName` when not null.

**Status Filters:**
- `all` - All allowlist entries
- `pending` - Emails not yet claimed by a user (claimedBy is null)
- `claimed` - Emails claimed by registered users (claimedBy is not null)

---

#### POST /allowlist
Add email to allowlist.

**Requires:** `allowlist:write` permission

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "notes": "Marketing team member - starts next week"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Valid email address (case-insensitive) |
| `notes` | string | No | Optional notes about this user |

**Response:**
```json
{
  "id": "uuid",
  "email": "newuser@example.com",
  "addedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "addedAt": "2024-01-01T00:00:00.000Z",
  "claimedBy": null,
  "claimedAt": null,
  "notes": "Marketing team member - starts next week"
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`).

**Error Cases:**
- 409 Conflict - Email already exists in allowlist
- 400 Bad Request - Invalid email format

---

#### DELETE /allowlist/:id
Remove email from allowlist.

**Requires:** `allowlist:write` permission

**Parameters:**
- `id` (UUID) - Allowlist entry ID

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Allowlist entry not found
- 400 Bad Request - Cannot remove entry that has been claimed by a user

**Note:** Entries that have been claimed (user has logged in) cannot be removed. This prevents accidentally removing access for existing users.

---

### Settings

#### GET /user-settings
**Requires Authentication** - Get current user's settings.

**Response:**
```json
{
  "theme": "light",
  "profile": {
    "displayName": "John Doe",
    "useProviderImage": true,
    "customImageUrl": null
  },
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `theme` | enum | UI theme: `light`, `dark`, `system` |
| `profile.displayName` | string \| null | User's display name override |
| `profile.useProviderImage` | boolean | Whether to use OAuth provider's profile image |
| `profile.customImageUrl` | string \| null | Custom profile image URL |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `version` | number | Version number for optimistic concurrency control |

---

#### PUT /user-settings
**Requires Authentication** - Replace all user settings.

**Request Body:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "Jane Doe",
    "useProviderImage": false,
    "customImageUrl": "https://example.com/avatar.jpg"
  }
}
```

**Response:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "Jane Doe",
    "useProviderImage": false,
    "customImageUrl": "https://example.com/avatar.jpg"
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "version": 2
}
```

**Note:** This replaces the entire settings object. Use PATCH for partial updates.

---

#### PATCH /user-settings
**Requires Authentication** - Partially update user settings.

**Request Body:**
```json
{
  "theme": "dark"
}
```

**Request Headers (Optional):**
```
If-Match: 1
```

**Response:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "John Doe",
    "useProviderImage": true,
    "customImageUrl": null
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "version": 2
}
```

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates in concurrent scenarios

**Note:** This performs a shallow merge with existing settings.

---

#### GET /system-settings
**Requires:** `system_settings:read` permission (Admin only)

Get system-wide settings.

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `ui.allowUserThemeOverride` | boolean | Allow users to override system theme |
| `security.jwtAccessTtlMinutes` | number | **Read-only.** JWT access token TTL in minutes, read from the `JWT_ACCESS_TTL_MINUTES` deploy-time environment variable — not stored settings, and not writable through this API |
| `security.refreshTtlDays` | number | **Read-only.** Refresh token TTL in days, read from the `JWT_REFRESH_TTL_DAYS` deploy-time environment variable — not stored settings, and not writable through this API |
| `features` | object | Feature flags (extensible) |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `updatedBy` | object | User who last updated settings |
| `version` | number | Version number for optimistic concurrency control |

---

#### PUT /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Replace all system settings.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {}
}
```

`security` is not part of the request body — it is a read-only, server-derived
block (see the GET fields table above). Sending it is not an error; the global
`ZodValidationPipe` silently strips unknown keys, so it has no effect.

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

---

#### PATCH /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Partially update system settings.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  }
}
```

**Request Headers (Optional):**
```
If-Match: 1
```

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates when multiple admins modify settings concurrently

---

### Notifications

The user's own inbox and the registry that drives their preferences page.

#### GET /notifications/events

Every event this application can raise, in preferences-page order: the three
foundation events first, then the nine coaching categories.

| Key | Label | Channels |
|---|---|---|
| `user.welcome` | Welcome | email |
| `allowlist.invitation` | Invitation to join | email |
| `security.role_changed` | Your roles changed | email, browser (**mandatory**) |
| `coach.commitment_upcoming` | Upcoming commitment | browser |
| `coach.start_cue` | Start cue | browser |
| `coach.rescue` | Start rescue | browser |
| `coach.fallback_offer` | Fallback offer | browser |
| `coach.family_presence` | Family presence cue | browser |
| `coach.recovery` | Recovery | browser |
| `coach.evidence` | Evidence celebration | browser |
| `coach.weekly_review_ready` | Weekly review ready | email, browser |
| `coach.plan_issue` | Plan issue | browser |

None of the coaching events is mandatory — every one can be silenced. Only the
weekly review carries an email: the other eight are moment-bound, and an email
that arrives twenty minutes after the moment has passed is noise.

#### GET /notifications

**Response 200:**

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "eventKey": "coach.family_presence",
        "title": "Phone-free dinner starts in 15 minutes",
        "body": "You said this matters: Mia talks at dinner",
        "link": "/today?commitment=<uuid>&action=in&n=<uuid>",
        "actions": [
          { "action": "in", "label": "I'm in", "link": "/today?commitment=<uuid>&action=in&n=<uuid>" },
          { "action": "move", "label": "Move it", "link": "/today?commitment=<uuid>&action=move&n=<uuid>" },
          { "action": "skip", "label": "Skip today", "link": "/today?commitment=<uuid>&action=skip&n=<uuid>" }
        ],
        "readAt": null,
        "createdAt": "2026-09-08T14:40:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
}
```

`actions` is **always present** — `[]` for events that have none — so a client
never has to distinguish "no actions" from "an older server".

Two things about it are worth knowing before relying on it:

- **It is derived, not stored.** The `notifications` table holds rendered text
  and a link, deliberately without a payload column, so the buttons are rebuilt
  from `(eventKey, link)` on every read. A button whose action no longer exists
  simply stops appearing rather than 404ing.
- **`?n=` is the attribution.** Every coaching link carries the id of the
  decision that produced it. Following a link records an `OPENED` interaction,
  and using a button records an `ACTIONED` one — which is how the independence
  metric can tell a commitment completed on its own from one that needed a
  reminder.

The `link` on every row is root-relative and validated at write time
(`sanitizeLink`); a client may hand it straight to its router.

#### Web push

| Method | Path | Auth |
|---|---|---|
| GET | `/notifications/push/public-key` | `@Auth()` |
| GET | `/notifications/push-subscriptions` | `@Auth()` |
| POST | `/notifications/push-subscriptions` | `@Auth()` |
| DELETE | `/notifications/push-subscriptions` | `@Auth()` |
| POST | `/notifications/interactions/dismissed` | **public** |

`GET /notifications/push/public-key` returns `{ "publicKey": null }` when the
deployment has no `WEB_PUSH_*` configuration. **That is a valid state, not an
error**: the push channel is inactive, and every user still gets the inbox row
and the live SSE update. Only the public half of the VAPID pair is ever
returned.

`POST /notifications/push-subscriptions` takes the browser's own
`PushSubscription.toJSON()` plus an optional user agent, and **upserts on the
endpoint** — including re-owning one that belonged to another account. One
browser profile signed out and signed in as somebody else is a real case, and
the endpoint is a property of the browser rather than of the account.

`GET /notifications/push-subscriptions` returns the endpoint **host**, never the
endpoint and never the keys. A full push endpoint is a bearer capability for that
device: anyone holding it can push to it.

`DELETE` takes the endpoint in the **body**, not in a query string — for the same
reason: a 2 KB capability URL in a query string lands in access logs and browser
history.

##### GET /notifications/metrics?days=30

What the coach has learned about its own messages. `days` is 7–180 (**400**
outside that): below seven days every rate is noise, above 180 the aggregation
walks rows nobody is asking a question about.

**Response 200:**

```json
{
  "data": {
    "window": { "from": "...", "to": "...", "days": 30 },
    "perEvent": [
      {
        "eventKey": "coach.commitment_upcoming",
        "category": "N1",
        "sent": 12, "opened": 8, "actioned": 6, "dismissed": 1, "ignored": 3,
        "suppressed": { "QUIET_HOURS": 2, "DAILY_CAP": 0, "…": 0 },
        "actionRate": 0.5,
        "bestLeadMinutes": 20
      }
    ],
    "independence": { "completions": 12, "unprompted": 7, "ratio": 0.583 },
    "reminderTrend": [
      { "month": "2026-08", "domain": "HEALTH", "sent": 9, "completions": 4 },
      { "month": "2026-09", "domain": "HEALTH", "sent": 2, "completions": 4 }
    ],
    "insights": [
      "You needed 9 Health reminders in August. In September you needed 2."
    ]
  }
}
```

Read it in the direction of **"can we stop?"**, not "how do we get more clicks?"
— a coach that is working needs to say less over time (VISION §38). Every
coaching event appears, in registry order, even at zero: a shape that depends on
what happened is one a client has to guard every field of.

- **`independence`** is PRD §65: completions with no `SENT` for that commitment
  *before* `completedAt`. A send afterwards does not count — a celebration fires
  after a completion by construction, and counting it would drive the metric down
  exactly when the user is doing best. `ratio` is `null` at zero completions:
  nothing having happened is no answer, not 0%.
- **`bestLeadMinutes`** is the lead bucket (5/10/20/30) with the best action rate
  among those with at least three sends. The threshold is what makes it a finding
  rather than a coincidence.
- **`reminderTrend`** groups by calendar month **in the user's timezone**. A send
  whose commitment was never completed is filed under no domain rather than a
  guessed one.
- **`insights`** are at most three deterministic sentences, held to the same
  banned-phrase rule as the notification copy. A domain whose reminders dropped
  is only reported when it *also* still has completions — fewer reminders with no
  completions is somebody who stopped, and congratulating them would be the worst
  thing this screen could say.

##### POST /notifications/interactions

```json
{ "sentInteractionId": "<uuid>", "kind": "ACTIONED", "action": "move" }
```

Two ways to name the message, because two surfaces know different things: the
bell holds an inbox row and sends `notificationId`; a deep link holds the `?n=`
the sender minted and sends `sentInteractionId`. One of the two is required
(**400** otherwise), and `action` is required when `kind` is `ACTIONED` — "they
did something" with no record of *what* cannot answer the only question the row
exists for.

`kind` is `OPENED`, `ACTIONED` or `DISMISSED`. `action` is one of `start`, `in`,
`move`, `short`, `skip`.

The event key and the commitment are **copied from the SENT row**, never taken
from the request, so a client cannot mislabel a response. A second `OPENED`
returns the first: opening twice is one open, and counting re-reads would measure
how often somebody revisits their inbox. A row belonging to another user answers
**404**, never 403.

Clients fire this and navigate without awaiting it: a metric must never be able
to delay or block the action it is measuring.

##### POST /notifications/interactions/dismissed — the one public route

```json
{ "sentInteractionId": "<uuid>" }
```

**204 always**, including for an id that does not exist — a different answer for
a real id would turn this into an oracle for guessing them. Throttled per
address.

It is public because a dismissal happens with **no page open**:
`notificationclose` fires in a service worker that may be the only thing running,
so there is no session and no bearer token. The two alternatives are both worse
— never recording dismissals loses the clearest signal a user gives about
unwanted messages, and keeping a credential inside a service worker puts one in
the least protected place in the browser.

The UUID is the entire capability, and what it can do is deliberately almost
nothing: it marks one already-sent notification as dismissed. It reads nothing
back, cannot be enumerated (a v4 UUID), and replaying it writes one more row
saying the same thing.

#### SSE `GET /notifications/stream`

The same shape, live, carrying the same `actions` field so a newly arrived row
renders its buttons without a refetch. The live event has the **precise** start
label ("Start workout", "Start 38 min") because it still holds the payload; the
same row re-read from `GET /notifications` says "Start", because a stored link
does not record which domain the commitment was in.

---

### Coaching Notification Policy (current user)

How often, and when, the coach may interrupt the calling user. An own-resource
surface: `@Auth()` only, no permission and no user id in the path.

Quiet hours live on `user_profiles.quiet_hours_start/end`; the caps live in
`user_profiles.notification_policy`. The endpoint hides that split — callers see
one object.

#### GET /me/notification-policy

Never 404. A user who has never opened the settings page gets the defaults, and
their profile row is created lazily.

**Response 200:**

```json
{
  "data": {
    "timezone": "America/Costa_Rica",
    "quietHours": null,
    "dailyCap": 4,
    "weeklyCap": 20,
    "perCommitmentMax": 2,
    "mutedCategories": [],
    "fatigue": { "active": false, "effectiveDailyCap": 4 }
  }
}
```

`fatigue` is the automatic reduction of PRD §61: when the user has been ignoring
coaching messages, `effectiveDailyCap` is lower than `dailyCap`, and the settings
page can say so rather than looking broken.

#### PATCH /me/notification-policy

A **merge patch**: an absent field is left alone.

| Field | Range | Notes |
|---|---|---|
| `quietHours` | `{ start, end }` as `HH:mm`, or `null` | Both bounds or neither. `null` clears them. Equal bounds read back as "no quiet hours" |
| `dailyCap` | 0–20 | 0 means "never interrupt me" |
| `weeklyCap` | 0–100 | |
| `perCommitmentMax` | 0–5 | How many messages one commitment may generate |
| `mutedCategories` | up to 20 `coach.*` event keys | |

Out-of-range values are **400** with the field named. Every accepted patch writes
an audit row `notification_policy:update` carrying the names of the changed
fields — never their values.

**Response 200:** the same shape as `GET`.

### AI Settings (Admin)

Which AI provider this deployment uses, the platform API key, and which model
each coaching persona runs on. Gated on `system_settings:read` for the reads and
`system_settings:write` for the save and the test.

**The platform API key is write-only.** It lives in the encrypted credential
store at `(purpose 'ai:openai', name 'platform')`, is never returned by any
endpoint, and submitting the field empty on `PUT` preserves the stored value.
Erasing it is not expressible through this API.

#### GET /ai-settings
**Requires `system_settings:read`** — the AI configuration plus the masked
status of the stored platform key.

A stored row that no longer validates does **not** fail this request: the
defaults come back with `settingsError` set, so the page that repairs the row
can still render.

**Response:**
```json
{
  "provider": "openai",
  "enabled": true,
  "defaultModel": "gpt-5.4",
  "personaModels": { "coach": "gpt-5.4-mini" },
  "platformKeyStatus": {
    "configured": true,
    "hint": "••••0000",
    "updatedAt": "2026-09-04T12:00:00.000Z",
    "updatedByUserId": "3f1c…"
  },
  "settingsError": null,
  "version": 2,
  "updatedAt": "2026-09-04T12:00:00.000Z",
  "updatedBy": { "id": "3f1c…", "email": "admin@example.com" }
}
```

---

#### PUT /ai-settings
**Requires `system_settings:write`** — replace the AI configuration.

Send `If-Match: <version>` for optimistic concurrency; `0` asserts that nothing
is stored yet, and a mismatch is **409 Conflict**.

**Request Body:**
```json
{
  "provider": "openai",
  "enabled": true,
  "baseUrl": null,
  "defaultModel": "gpt-5.4",
  "personaModels": { "coach": "gpt-5.4-mini", "planner": null },
  "platformApiKey": "sk-..."
}
```

| Field | Notes |
|-------|-------|
| `platformApiKey` | **Write-only.** Omit, `null` or `""` keeps the stored key. |
| `defaultModel`, `personaModels.*` | Must be GPT 5.4 or newer, else **400**. `null` on a persona means "use the default". |
| `personaModels` keys | Must be known persona keys, else **400**. |
| `baseUrl` | Optional override. Must use `https://` in production, else **400**. |

---

#### GET /ai-settings/personas
**Requires `system_settings:read`** — the personas a model can be assigned to,
in registry order. The web app reads this rather than keeping its own copy.

**Response:**
```json
[
  {
    "key": "coach",
    "label": "Coach",
    "description": "Day-to-day coaching replies, help starting, and decomposition.",
    "tier": "fast",
    "capabilities": ["text"]
  }
]
```

---

#### GET /ai-settings/models
**Requires `system_settings:read`** — the models the stored platform key can
reach, filtered to GPT 5.4 or newer and sorted newest first.

`?refresh=true` bypasses the 5-minute cache and is throttled to 10 per minute
per user (**429** with `Retry-After`).

**This returns HTTP 200 even when the provider could not be reached.** Read
`success`; on failure `error` carries the provider's message and `models` may
still hold the last known catalog with `source: "cache"`.

**Response:**
```json
{
  "success": true,
  "models": [{ "id": "gpt-5.4", "created": 1772000000 }],
  "fetchedAt": "2026-09-04T12:00:00.000Z",
  "source": "live",
  "error": null
}
```

---

#### POST /ai-settings/test
**Requires `system_settings:write`** — run two probes with the stored platform
key: a catalog listing (validates the key) and, when a default model is
configured, a 16-token structured generation (validates the key against that
model). Throttled to 5 per minute per user (**429** with `Retry-After`).

**This returns HTTP 200 even when the connection failed.** A refused connection
is a successful diagnosis and is why the endpoint exists — read `success`, and
show `error`, which carries the provider's own message with any credential
redacted.

**Response:**
```json
{
  "success": true,
  "providerKind": "openai",
  "model": "gpt-5.4",
  "latencyMs": 412,
  "error": null,
  "attemptedAt": "2026-09-04T12:00:00.000Z",
  "checks": { "listModels": "passed", "generate": "passed" }
}
```

`checks.generate` is `"skipped"` — not `"failed"` — when no default model is
configured: there is nothing to generate against, and the key is still proven
by `listModels`.

---

### AI Key (current user)

Every user of EvolvePath brings their own OpenAI API key: the gateway makes
every product AI call with the caller's own key, never the platform's. These
endpoints require authentication only — no permission — because the resource is
the caller's own and there is no user id in any path.

**The key is never returned by any endpoint.** It is stored encrypted at
`(purpose 'ai:openai:user', name '<your user id>')`, and only its non-secret
mask (`hint`) is ever published.

#### GET /me/ai-key
**Requires Authentication** — the status of your key.

`lastTest` is derived from the `ai_invocations` telemetry table rather than
stored on the credential, so there is one source of truth for it. `platform`
reports just enough of the deployment's configuration to explain a skipped
generate probe — that is the administrator's to fix, not yours.

**Response:**
```json
{
  "configured": true,
  "hint": "••••0000",
  "updatedAt": "2026-09-04T12:00:00.000Z",
  "lastTest": {
    "attemptedAt": "2026-09-04T12:01:00.000Z",
    "success": true,
    "model": "gpt-5.4",
    "error": null
  },
  "platform": { "provider": "openai", "enabled": true, "hasDefaultModel": true }
}
```

---

#### PUT /me/ai-key
**Requires Authentication** — save or replace your key. Returns the same body
as `GET`.

**Request Body:**
```json
{ "apiKey": "sk-..." }
```

The key must be 20–512 characters with no whitespace anywhere (a value with an
internal space is a line-wrapped paste and is rejected rather than trimmed).
The `sk-` prefix is deliberately **not** enforced server-side. Violations are
**400**.

---

#### DELETE /me/ai-key
**Requires Authentication** — remove your key. **204**, and idempotent:
removing a key that is not there succeeds. Afterwards you are asked for a key
again before you can use the application.

---

#### POST /me/ai-key/test
**Requires Authentication** — run a catalog listing with your key and, when the
administrator has chosen a default model, a 16-token structured generation
against it. Throttled to 5 per minute (**429** with `Retry-After`).

**This returns HTTP 200 even when the test failed** — read `success`, and show
`error`, which carries OpenAI's own message with any credential redacted. The
response shape is identical to `POST /ai-settings/test`.

---

### Onboarding

The first gate a signed-in user passes after the BYOK key setup (PRD §19–§20,
epic E04). Every route is `@Auth()` and every one addresses the caller's own
`user_profiles` row — there is no such thing as somebody else's onboarding, so
there is no permission to check and no 403 to return.

**Two rules the whole section rests on:**

- **Answers are saved per step.** PRD §19 gives this five to eight minutes on a
  phone, and a phone locks. A wizard holding its answers in React state loses
  them to a notification.
- **The plan is not saved at all until it is approved.** `POST
  /onboarding/propose` writes the proposal to `user_profiles.pending_proposal`
  and nothing else; `outcomes`, `plans`, `plan_versions`, `routines` and
  `commitments` gain no rows until `POST /onboarding/approve` (PRD §15).

#### GET /onboarding
**Requires Authentication** — the state the wizard resumes from. Safe to call
on every boot; creates the profile row if the user has never had one.

**Response:**
```json
{
  "data": {
    "step": "TIME",
    "completed": false,
    "answers": {
      "sixMonthVision": "Stop wasting mornings, be present at dinner, get back in shape",
      "domains": ["WORK", "FAMILY", "HEALTH"],
      "domainReflections": { "work": "I start with email every day" },
      "obstacles": ["PROCRASTINATE", "TOO_AMBITIOUS"],
      "weekdayMinutes": 45,
      "healthBaseline": null,
      "coachingStyle": "BALANCED"
    },
    "pendingProposal": null,
    "proposalSource": null,
    "confidenceScore": null
  },
  "meta": { "timestamp": "2026-09-06T10:00:00.000Z" }
}
```

`proposalSource` is `"ai"` or `"template"` and is read off the stored row. It
is what `approve` attributes the plan version to; a client cannot claim it.

---

#### POST /onboarding/start
**Requires Authentication** — records the timezone everything in this flow is
scheduled in, and moves `onboardingStep` off `PROMISE`.

**Request Body:**
```json
{ "timezone": "America/Costa_Rica", "locale": "es" }
```

The timezone is required and is not guessed from an IP: every commitment this
flow creates is an instant computed from it, and a wrong one puts tonight's
dinner on tomorrow. The browser knows the answer
(`Intl.DateTimeFormat().resolvedOptions().timeZone`).

**200** with the state. **400** `INVALID_TIMEZONE` for a zone the runtime cannot
resolve. **409** `ONBOARDING_ALREADY_COMPLETED`.

A user who walks back to step 1 to fix their timezone is **not** dragged forward
to step 2 again — the step only advances from `PROMISE`.

---

#### PATCH /onboarding/answers
**Requires Authentication** — save one step. A merge patch: an absent key is
left alone.

**Request Body** (every key optional, at least one required):
```json
{
  "step": "TIME",
  "sixMonthVision": "…",
  "domains": ["WORK", "HEALTH"],
  "domainReflections": { "work": "…", "family": "…", "health": "…" },
  "obstacles": ["PROCRASTINATE"],
  "weekdayMinutes": 45,
  "healthBaseline": {
    "experience": "BEGINNER",
    "daysPerWeek": 3,
    "minutesPerSession": 30,
    "equipment": ["Dumbbells"],
    "preferences": "…",
    "limitations": "…"
  },
  "coachingStyle": "BALANCED"
}
```

**Strict.** An unknown key is a **400** rather than a silently dropped answer:
the wizard saves as the user types, and a typo'd field name answering 200 would
look like a working save and lose the answer.

`step` records where the client now is. **`DONE` is rejected** — completion is
`approve`'s to declare, and a client that could patch its way there would have a
completed account with no Path in it.

**409** `ONBOARDING_ALREADY_COMPLETED`.

---

#### POST /onboarding/propose
**Requires Authentication** — ask the coach for a first Path. Empty body.

Calls the `planner` persona with prompt version `onboarding-proposal.v1` and the
`onboarding_proposal` schema, then holds the output to the guardrails below.
Stores the result on `user_profiles.pending_proposal` **and nowhere else**.

**Response:**
```json
{
  "data": {
    "source": "ai",
    "proposal": {
      "bestSelf": {
        "identityStatement": "I start important work before I become reactive. …",
        "workIdentity": "Someone who protects the work that matters",
        "familyIdentity": null,
        "healthIdentity": null,
        "sixMonthVision": "…"
      },
      "outcomes": [
        {
          "domain": "WORK",
          "title": "Protect my most important work",
          "whyItMatters": "…",
          "successDefinition": "…"
        }
      ],
      "routines": [
        {
          "domain": "WORK",
          "title": "Start the most important task before email",
          "triggerType": "WEEKDAYS",
          "triggerValue": "Mon,Wed,Fri",
          "frequency": "3x per week",
          "idealMinutes": 25,
          "minimumMinutes": 10,
          "fallbackBehavior": "Open the task and write the first sentence"
        }
      ],
      "firstWeekCommitments": [
        {
          "domain": "WORK",
          "title": "Start the most important task before email",
          "scheduledStart": "2026-09-07T13:30:00.000Z",
          "durationMinutes": 25,
          "fullVersion": "25 focused minutes on the most important task",
          "shortVersion": "15 minutes on the most important task",
          "minimumVersion": "Open the task and write the first sentence"
        }
      ],
      "rationale": "…",
      "reducedFromRequest": false
    }
  }
}
```

**Guardrails**, applied identically to model output, to the template, and to the
copy the user edited before approving:

| Rule | Why |
|---|---|
| At most one outcome per selected domain, and only selected domains | A first Path is what the user asked for, not what the model found interesting |
| At most **3** routines in total | PRD §70. A first plan with five habits is a plan abandoned in week two |
| `minimumMinutes <= idealMinutes` | A minimum longer than the full version is not a fallback |
| Every `scheduledStart` inside `[today − 1 day, today + 8 days]` **in the user's timezone** | "The first week" means the first week |
| Commitment domains ⊆ selected domains | As above |
| No single local day above `weekdayMinutes`, when the user answered | PRD §20 step 5 asked; ignoring the answer makes asking dishonest |

**A violation is never corrected.** Model output that breaks a rule is discarded
whole and answered as a schema failure — a plan the server quietly fixed is a
plan the user approves believing the coach wrote it.

**400** `ONBOARDING_INCOMPLETE` when `sixMonthVision` or `domains` is missing.
**409** `ONBOARDING_ALREADY_COMPLETED`.
**412** `AI_KEY_REQUIRED` — the one AI failure the user can fix.
**503** with `details: { reason: "AI_UNAVAILABLE", code, retryable }`.
`retryable` is true for `rate_limit`, `timeout`, `network` and `provider`, and
false for `ai_disabled`, `no_model`, `schema` and `refusal` — it is what chooses
between the wizard's `Try again` and `Continue without AI`.

---

#### POST /onboarding/skip-ai
**Requires Authentication** — a starting Path with no model involved. Empty body.

PRD §120: the flow **completes** with the provider down — not an apology and a
retry button, but a plan the user can actually approve. Deterministic, built
from the only things the server knows without a model: which domains the user
picked, how many minutes they said they have, and what day it is where they are.

Held to the same guardrails the model is, and **honest about being a template**
in its own `rationale`.

Per selected domain: Work — "Start the most important task before email"
(Mon/Wed/Fri, 25 / 10 minutes, fallback "Open the task and write the first
sentence"); Family — "Phone-free dinner" (Tue/Thu/Sun, 30 / 10, "Ten minutes of
undivided attention"); Health — "Three 30-minute strength sessions"
(Mon/Wed/Sat, 30 / 10, "A 10-minute walk"), with the user's `healthBaseline`
days capped at three.

Domains landing on the same day **share that day's minutes**, so a three-domain
user with 45 minutes gets a plan that fits rather than one the guardrails reject.

**200** with `source: "template"`. **400** `ONBOARDING_INCOMPLETE` or
`PROPOSAL_INVALID`. **409** `ONBOARDING_ALREADY_COMPLETED`.

---

#### POST /onboarding/confidence
**Requires Authentication** — PRD §72's question, asked before the plan is
activated: *"How confident are you that you can do this in a difficult week?"*

**Request Body:** `{ "score": 2 }` — an integer 1–5.

**1 or 2 replaces the plan with a smaller one**, by the route it came from: an
AI proposal is re-proposed with the reduce instruction and the previous plan in
the input; a template is reduced arithmetically (drop the heaviest behaviour,
halve the rest with a ten-minute floor). **3 and above** stores the score and
changes nothing.

**Response:** `{ "proposal": …, "source": "ai", "reproposed": true }`.

**400** `NO_PENDING_PROPOSAL`. **409** `ONBOARDING_ALREADY_COMPLETED`. **412** /
**503** as for `propose`.

---

#### POST /onboarding/approve
**Requires Authentication** — the PRD §15 approval step, and the only path in
this flow that turns a proposal into rows.

**Request Body:** `{ "proposal": { … } }` — the pending proposal, possibly
edited. `source` is deliberately **not** in the body: it is read off the stored
row, because a client claiming `"ai"` would put the coach's name on a plan it
never wrote.

One `$transaction`:

1. `best_self_profiles` — upserted from `proposal.bestSelf`
2. per outcome: an `outcomes` row, its `plans` row, and `plan_versions` v1
   `{ status: ACTIVE, userApproved: true, createdBy: AI | USER, rationale,
   expectedWeeklyLoad, fallbackStrategy }`
3. per routine: a `routines` row under that domain's version
4. per commitment: a `commitments` row `{ status: PLANNED }` carrying all three
   versions, linked to its routine **by title** — the contract has no ids in it,
   because a model inventing one would point a commitment at another user's
   routine
5. `domain_modes` `GROW` for every selected domain
6. the profile: `onboardingStep = DONE`, `onboardingCompletedAt = now`,
   `pendingProposal` cleared

Then, **after** the transaction, one `onboarding:approved` audit row with
`{ source, outcomes, routines, commitments, edited, confidenceScore }` —
counts, never content. A row written inside would be rolled back with the thing
it is evidence of.

**201:**
```json
{
  "data": {
    "bestSelfId": "…",
    "outcomeIds": ["…"],
    "planVersionIds": ["…"],
    "routineIds": ["…"],
    "commitmentIds": ["…"]
  }
}
```

**400** `PROPOSAL_INVALID` with `details.rules[]` naming each broken rule in a
sentence — the review screen renders them under the offending section.
**409** `ONBOARDING_ALREADY_COMPLETED`.

**The second approve is a 409, not a silent no-op.** A client that raced two
submits needs to be able to tell which one built the Path; a silent success
would return a second set of ids for rows that were never created.

---

### EvolvePath

The product domain: who the user is trying to become, what they are trying to
achieve, and what posture each life domain is in. Every endpoint here requires
authentication only — no permission — because every row belongs to the caller.

**Ownership is answered with 404, never 403.** A resource that belongs to
another user is byte-identical to one that never existed: same status, same
message, same body shape. A 403 would confirm that a guessed id is real.

#### GET /me/best-self
**Requires Authentication** — the caller's Best Self profile (PRD §10.2).

Answers **200** with `"data": null` until the profile has been saved once — an
unsaved profile is an empty card on the Path screen, not a missing resource.

**Response:**
```json
{
  "data": {
    "id": "8c1e…",
    "identityStatement": "Focused, present, healthy",
    "workIdentity": null,
    "familyIdentity": null,
    "healthIdentity": null,
    "sixMonthVision": null,
    "motivations": ["family"],
    "reasons": [],
    "lastReviewedAt": "2026-02-01T10:00:00.000Z",
    "createdAt": "2026-02-01T10:00:00.000Z",
    "updatedAt": "2026-02-01T10:00:00.000Z"
  },
  "meta": { "timestamp": "2026-02-01T10:00:05.000Z" }
}
```

---

#### PUT /me/best-self
**Requires Authentication** — replace the profile whole and stamp
`lastReviewedAt`. There is deliberately no `PATCH`: a Best Self statement is
one thought, and a half-updated one is not a state the user asked for. Omitted
fields are **cleared**.

**Request Body:**
```json
{
  "identityStatement": "Focused, present, healthy",
  "sixMonthVision": "Training three times a week without negotiating with myself",
  "motivations": ["family", "energy"],
  "reasons": ["I want to be around for them"]
}
```

Every string field is optional and nullable. `identityStatement`,
`workIdentity`, `familyIdentity` and `healthIdentity` cap at 500 characters,
`sixMonthVision` at 2000; `motivations` and `reasons` are up to 10 entries of
up to 200 characters each. Violations are **400**.

Audit: `best_self:replace`, whose `meta` records **which fields were filled in
and nothing they contain** — `audit_events` is admin-readable.

---

#### GET /outcomes
**Requires Authentication** — the caller's outcomes, ordered by domain, then
importance (descending), then creation time.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `domain` | enum | `WORK` \| `FAMILY` \| `HEALTH` |
| `state` | enum | `ACTIVE` \| `PAUSED` \| `COMPLETED` \| `ARCHIVED` |
| `includeArchived` | boolean | Default `false`. Archived outcomes are excluded unless this is `true` or `state=ARCHIVED` is passed. |

**Response:** `data` is an array of the object shown under `GET /outcomes/{id}`.

---

#### POST /outcomes
**Requires Authentication** — create an outcome. **201**.

**Request Body:**
```json
{
  "domain": "HEALTH",
  "title": "Three strength workouts per week",
  "description": null,
  "targetDate": "2026-04-15",
  "importance": 4,
  "motivation": "I want my energy back",
  "successDefinition": "Three sessions logged, every week, for six weeks",
  "userConfidence": 3
}
```

`domain` and `title` are required; `importance` defaults to `3`. `importance`
and `userConfidence` are integers 1–5. `targetDate` is a plain `YYYY-MM-DD`
date with no time of day — it is stored as a `date`, not a timestamp, so it
cannot shift by a day across timezones.

Audit: `outcome:create` with `meta: { domain, importance }`.

---

#### GET /outcomes/{id}
**Requires Authentication** — one outcome. **404** if unknown *or* not owned by
the caller.

**Response:**
```json
{
  "data": {
    "id": "3f2a…",
    "domain": "HEALTH",
    "title": "Three strength workouts per week",
    "description": null,
    "targetDate": "2026-04-15",
    "importance": 4,
    "motivation": null,
    "state": "ACTIVE",
    "successDefinition": null,
    "userConfidence": null,
    "archivedAt": null,
    "planId": "9b71…",
    "activePlanVersion": { "id": "c4d8…", "version": 2 },
    "createdAt": "2026-02-01T10:00:00.000Z",
    "updatedAt": "2026-02-01T10:00:00.000Z"
  }
}
```

`planId` is `null` until a plan is created, and `activePlanVersion` is `null`
while the plan has only drafts.

---

#### PATCH /outcomes/{id}
**Requires Authentication** — update an outcome. At least one field is
required.

`domain` is **immutable** and is rejected: an outcome's domain is what files it
under Work, Family or Health, and moving it would orphan the plan, routines and
commitments sized for that domain's mode. `state` accepts `ACTIVE`, `PAUSED` or
`COMPLETED` only — archiving goes through the endpoint below, which also stamps
`archivedAt`.

Editing an archived outcome is **409 `CONFLICT`**: the user archived it
deliberately, and an edit is not the gesture that should bring it back.

Audit: `outcome:update` with `meta: { changed: [...] }` — field names, not
values.

---

#### POST /outcomes/{id}/archive
**Requires Authentication** — archive an outcome. **200**.

Sets `state` to `ARCHIVED` and stamps `archivedAt`. **Idempotent**: archiving
an already-archived outcome answers 200, writes nothing and produces no second
audit row, so a double-tap on a phone is harmless.

Audit: `outcome:archive`.

---

#### GET /me/domain-modes
**Requires Authentication** — the caller's per-domain posture (PRD §49).

Always exactly three entries, in the order `WORK`, `FAMILY`, `HEALTH`. A domain
the user has never set has **no stored row** and is reported as `GROW` with a
null `effectiveFrom`; nothing is seeded at sign-up, so "has the user chosen a
posture?" stays answerable.

**Response:**
```json
{
  "data": [
    { "domain": "WORK", "mode": "GROW", "reason": null, "effectiveFrom": null },
    { "domain": "FAMILY", "mode": "GROW", "reason": null, "effectiveFrom": null },
    {
      "domain": "HEALTH",
      "mode": "RECOVER",
      "reason": "Back strain",
      "effectiveFrom": "2026-02-01T10:00:00.000Z"
    }
  ]
}
```

---

#### PUT /me/domain-modes/{domain}
**Requires Authentication** — set the posture for one domain. **200**.

`{domain}` must be `WORK`, `FAMILY` or `HEALTH`; anything else is **400**, not
404 — an unknown domain is a malformed request, not a missing resource.

**Request Body:**
```json
{ "mode": "RECOVER", "reason": "Back strain" }
```

`mode` is `GROW` \| `MAINTAIN` \| `RECOVER` \| `PAUSE`; `reason` is optional,
up to 500 characters. `effectiveFrom` moves **only when the mode actually
changes**, so re-saving the same mode with a new reason does not reset "since
when".

Audit: `domain_mode:set` with `meta: { domain, from, to }`.

---

#### Plans and plan versions

A **Plan** is the stable container — one per outcome, and nothing mutable on
it. Everything a user would call "the plan" lives on a **PlanVersion**, and
versions are append-only:

```
              activate
   DRAFT ─────────────────► ACTIVE ─────────────────► SUPERSEDED
     │                        (at most one per plan,      (activeUntil set)
     │                         enforced by a partial
     │                         unique index)
     │  reject
     └──────────► REJECTED
```

A superseded or rejected version stays fully readable, routines and all. PRD
§103 requires the user to be able to inspect *why* the plan changed, and that
needs both sides of every change to still exist.

---

#### POST /outcomes/{outcomeId}/plans
**Requires Authentication** — create the plan for an outcome. **201**.

Creates the plan, its v1 and any inline routines in **one transaction**. v1 is
`ACTIVE` and `userApproved: true` immediately — a first plan that landed as a
draft would ask the user to approve what they just wrote.

**Request Body:**
```json
{
  "rationale": "Start with mornings",
  "expectedWeeklyLoad": 120,
  "fallbackStrategy": "If the week collapses, keep Saturday only",
  "routines": [
    {
      "title": "Morning workout",
      "triggerType": "EVENT",
      "triggerValue": "after morning coffee",
      "frequency": "WEEKDAYS",
      "preferredTime": "06:30",
      "estimatedDurationMin": 45,
      "minimumDurationMin": 10,
      "fallbackBehavior": "10-minute bodyweight circuit"
    }
  ]
}
```

Every field is optional; `routines` is capped at 10. Each routine's `domain`
defaults to the outcome's. **409** if the outcome already has a plan or is
archived.

Audit: `plan:create`.

---

#### GET /outcomes/{outcomeId}/plans
**Requires Authentication** — zero or one element. The array shape is
deliberate: allowing several plans later becomes a data change rather than a
breaking response change.

---

#### GET /plans/{id}
**Requires Authentication** — the plan and its active version.

**Response:**
```json
{
  "data": {
    "id": "9b71…",
    "outcomeId": "3f2a…",
    "activeVersion": {
      "id": "c4d8…",
      "version": 2,
      "status": "ACTIVE",
      "rationale": "Evenings kept slipping; move to two mornings + Saturday",
      "createdBy": "USER",
      "userApproved": true,
      "previousVersionId": "a119…",
      "activeFrom": "2026-02-08T09:00:00.000Z",
      "activeUntil": null,
      "routineCount": 2,
      "createdAt": "2026-02-08T08:55:00.000Z"
    },
    "versionCount": 2,
    "createdAt": "2026-02-01T10:00:00.000Z"
  }
}
```

`activeVersion` is `null` while the plan has only drafts.

---

#### GET /plans/{id}/versions
**Requires Authentication** — the whole history, newest first, so it reads
downward from what is in force now.

**Response:**
```json
{
  "data": [
    {
      "id": "c4d8…",
      "version": 2,
      "status": "ACTIVE",
      "rationale": "Evenings kept slipping; move to two mornings + Saturday",
      "createdBy": "USER",
      "userApproved": true,
      "previousVersionId": "a119…",
      "activeFrom": "2026-02-08T09:00:00.000Z",
      "activeUntil": null,
      "routineCount": 2,
      "createdAt": "2026-02-08T08:55:00.000Z"
    },
    {
      "id": "a119…",
      "version": 1,
      "status": "SUPERSEDED",
      "rationale": "Start with mornings",
      "createdBy": "USER",
      "userApproved": true,
      "previousVersionId": null,
      "activeFrom": "2026-02-01T10:00:00.000Z",
      "activeUntil": "2026-02-08T09:00:00.000Z",
      "routineCount": 1,
      "createdAt": "2026-02-01T10:00:00.000Z"
    }
  ]
}
```

---

#### GET /plans/{id}/versions/{version}
**Requires Authentication** — one version in full: the summary above plus
`planId`, `expectedWeeklyLoad`, `fallbackStrategy` and `routines`.

`{version}` is the **integer version number** ("2"), not the version's UUID —
it is what the user sees. `previousVersionId` links by id internally.

---

#### POST /plans/{id}/versions
**Requires Authentication** — draft the next version. **201**.

**Request Body:**
```json
{
  "rationale": "Evenings kept slipping; move to two mornings + Saturday",
  "expectedWeeklyLoad": 150,
  "copyRoutinesFrom": "active"
}
```

`rationale` is **required** (1–2000 characters): PRD §80 wants "Changed Sep 12
· Reason: 3 repeated evening misses" renderable for every change, and the
moment the user knew why has passed by the time anybody notices it is missing.

`copyRoutinesFrom` is `"active"` (default) or `"none"`. Copied routines are
**clones** with new ids — the source version keeps its own.

The new version is `DRAFT`, `userApproved: false`, `createdBy: USER`, with
`previousVersionId` set to the currently active version (or the newest version
when none is active). `createdBy` is never accepted from the body.

**409** if a draft already exists — one draft at a time. This is a service
rule about focus, not a database constraint; do not add a second partial index
for it.

Audit: `plan_version:create` with `meta: { planId, version, previousVersionId,
createdBy, routinesCopied }`.

---

#### PATCH /plans/{id}/versions/{version}
**Requires Authentication** — edit `rationale`, `expectedWeeklyLoad` or
`fallbackStrategy`. **409 unless the version is still `DRAFT`**: a version that
has been in force is a historical record, and editing its rationale rewrites
why the user says they changed.

---

#### POST /plans/{id}/versions/{version}/activate
**Requires Authentication** — put a draft in force. **200**.

In one transaction: the current `ACTIVE` version becomes `SUPERSEDED` with
`activeUntil` set, and the target becomes `ACTIVE` with `activeFrom` set and
`userApproved: true`.

**409** unless the target is a `DRAFT`. Also **409**, never 500, when another
activation raced this one — the partial unique index rejects a second `ACTIVE`,
and the loser of a race is told someone else changed the plan.

Audit: `plan_version:activate` with `meta: { planId, version, supersededVersion }`.

---

#### POST /plans/{id}/versions/{version}/reject
**Requires Authentication** — mark a draft `REJECTED`. **200**, **409** unless
it is a `DRAFT`.

**Request Body:** `{ "reason": "Too much for this month" }` (optional).

The version's `rationale` is **kept**: a rejected version is part of the record
of what the user considered and decided against.

---

#### Routines

A routine is one repeatable behaviour belonging to one plan version: what
starts it, how often, how long it ideally takes, and the shortest version that
still counts.

#### GET /routines
**Requires Authentication** — the routines of one plan version.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `planVersionId` | uuid | **Required.** Routines are only meaningful inside one version; a cross-version listing would mix a superseded plan's behaviours with the live one's. |
| `includeInactive` | boolean | Default `false`. |

Ordered by `sortOrder`, then creation time.

---

#### POST /routines
**Requires Authentication** — add a routine. **201**.

**Request Body:**
```json
{
  "planVersionId": "c4d8…",
  "title": "Morning workout",
  "triggerType": "EVENT",
  "triggerValue": "after morning coffee",
  "frequency": "WEEKDAYS",
  "daysOfWeek": [],
  "preferredTime": "06:30",
  "estimatedDurationMin": 45,
  "minimumDurationMin": 10,
  "fallbackBehavior": "10-minute bodyweight circuit",
  "sortOrder": 0
}
```

Rules, all **400** when broken:

| Field | Rule |
|-------|------|
| `title` | 1–200 characters |
| `domain` | Optional; defaults to the outcome's |
| `triggerType` | `TIME` (default) or `EVENT` |
| `triggerValue` | `HH:mm` when `TIME`; **required** when `EVENT` — an implementation intention with no "when" is not one |
| `frequency` | `DAILY` \| `WEEKDAYS` (default) \| `WEEKENDS` \| `WEEKLY` \| `CUSTOM` |
| `daysOfWeek` | 0 = Sunday … 6 = Saturday, unique. Required non-empty for `CUSTOM`, must be empty otherwise |
| `preferredTime` | `HH:mm`, optional |
| `estimatedDurationMin` | 1–480 |
| `minimumDurationMin` | 1–480 and **not greater than** `estimatedDurationMin` — the minimum version is the bad-day path (PRD §57), and a minimum longer than the ideal makes the bad day the harder one |
| `fallbackBehavior` | ≤ 500 characters |

**409** if the plan version is `SUPERSEDED` or `REJECTED`.

---

#### GET /routines/{id} · PATCH /routines/{id} · DELETE /routines/{id}
**Requires Authentication.** `PATCH` accepts any subset of the create fields
plus `active`; `DELETE` answers **204**.

`planVersionId` cannot be patched: moving a routine between versions would
rewrite the history of the version it left.

The cross-field rules above are re-checked against the **merged** routine on a
`PATCH`, so a patch setting only `minimumDurationMin: 90` on a 45-minute
routine is rejected (**409**) even though 90 is valid in isolation.

**409** on any write when the plan version is `SUPERSEDED` or `REJECTED` — its
routines are the record of what the plan used to say.

---

### Today

The product's primary surface (PRD §12/§13). Two routes, and the split is the
design: **`GET /today` makes no AI call at all**, so the whole screen renders
with the provider down. The coach's sentence is a second, optional request.

---

#### GET /today
**Requires Authentication** — the day.

```json
{
  "greeting": "morning",
  "stateLine": "3 commitments today. Health is in maintenance mode this week.",
  "dateLocal": "2026-03-02",
  "timeZone": "America/Costa_Rica",
  "checkIn": { "feel": "LOW_ENERGY" },
  "nextBestAction": {
    "commitmentId": "5a2b…",
    "title": "Open the doc and write one sentence",
    "domain": "WORK",
    "durationMinutes": 5,
    "version": "minimum",
    "rationale": "You said: “Free my evenings”. The 5-minute version keeps that alive today.",
    "fallback": { "title": "5-minute start", "durationMinutes": 5 },
    "interventionMode": "RECONNECT",
    "confidence": 0.62
  },
  "domains": [
    { "domain": "WORK", "mode": "GROW", "commitments": [ "…commitment cards…" ] },
    { "domain": "FAMILY", "mode": "GROW", "commitments": [] },
    { "domain": "HEALTH", "mode": "PAUSE", "commitments": [ "…" ] }
  ],
  "momentum": {
    "WORK": { "state": "SLIPPING", "headline": "3 in a row not started" },
    "FAMILY": { "state": "INSUFFICIENT_DATA", "headline": "Not enough planned family commitments yet — momentum appears after 3" },
    "HEALTH": { "state": "STEADY", "headline": "5 of 6 planned workouts completed" }
  },
  "coachInsight": null
}
```

**`momentum` is the summary, not the reading.** A state word and one sentence
per domain — the full window, its signals and the trend live on `GET /progress`
(epic E11). It is computed from the same engine, so the two screens can never
disagree; when that computation fails the field degrades to
`INSUFFICIENT_DATA` with a null headline and the day still returns 200, because
Progress is a secondary reading on a screen about the next hour.

**`domains` always has three entries, in canonical order** — including the empty
and the paused. A domain that vanished because nothing was scheduled would look
like data loss. A domain in `PAUSE` is **never** the next best action but still
gets its card: the user chose to put it down, not to hide it.

**`nextBestAction` is null** when there is nothing to recommend. An empty day is
not a failure state.

**The day boundary is the user's.** `dateLocal` and the candidate window come
from `user_profiles.timezone`; a stored zone the runtime cannot resolve degrades
to UTC with a warning rather than failing the request. Yesterday's still-planned
commitments are **not** candidates — VISION §33 refuses catch-up debt.

##### How the recommendation is chosen

PRD §13: "The AI should not freely invent priority." The engine is deterministic
and additive — every term is `weight × factor` with `factor ∈ [0,1]`, so the
breakdown sums to the score and no term can silently dominate.

| Term | Weight | Factor |
|---|---|---|
| Importance | 30 | `importance / 5` |
| Urgency | 25 | the larger of a 12-hour schedule ramp (overdue = 1) and a 7-day deadline ramp |
| Repeated avoidance | 20 | `min(rescheduleCount, 3) / 3`, read from the live row |
| Plan relevance | 10 | active plan 1, inactive 0.5, none 0 |
| Domain balance | 10 | mode factor (GROW 1, RECOVER 0.75, MAINTAIN 0.5) × 1 if untouched today else 0.25 |
| Contextual fit | 10 | 1 inside the hour either side of the scheduled window |
| Effort mismatch | −25 | 1 when the chosen size exceeds the minutes left today |
| Conflict | −40 | 1 when a *different* commitment is already running |
| Fatigue | −15 | feel factor (LOW_ENERGY 1, PACKED/UNEXPECTED_PROBLEM 0.5) × `min(minutes/60, 1)` |

Ties resolve by earlier `scheduledStart`, then earlier `createdAt`, then id — so
two equally good commitments do not swap places between refreshes. `confidence`
is the gap to second place, clamped to 0.2–0.95 (0.9 for a lone candidate).

**One pre-rule overrides all of it:** a commitment already `STARTED` today *is*
the next best action, in `ACT` mode, counting down its own timer. Ranking it
against the rest would let the engine tell a user to abandon what they are doing.

##### Which size, and which posture

The size follows the check-in: `LOW_ENERGY` → the minimum, `PACKED` /
`UNEXPECTED_PROBLEM` → the short version, otherwise the full one stepped down
only when it does not fit the remaining budget, never below the minimum. **A size
the user never declared is never offered** — inventing a short version would be
the product proposing a smaller commitment nobody agreed to.

`interventionMode` is VISION §21's posture, resolved by the first matching rule:

| Mode | When |
|---|---|
| `RECOVER` | 3+ days since any evidence, and the user has logged something before |
| `CHALLENGE_PLAN` | the top candidate's routine failed 4+ times in 14 days |
| `DIAGNOSE` | the top candidate has been moved twice or more |
| `REDUCE` | check-in `PACKED`/`UNEXPECTED_PROBLEM`, or the chosen size exceeds the budget |
| `RECONNECT` | check-in `LOW_ENERGY` |
| `CLARIFY` | the outcome states neither motivation nor a definition of done |
| `REINFORCE` | 3+ completions in 7 days with nothing missed |
| `ACT` | otherwise |

Order is the design, not an implementation detail: all of these can be true at
once for someone having a hard week, and the winner decides what the product
says to them. A brand-new account never gets `RECOVER` — never having logged
anything is not a lapse.

`rationale` is a deterministic template per mode, filled from the candidate.
It is **never AI**: a card that says "Draft the storyline · 25 min" and nothing
else is a to-do list, and PRD §120 requires the screen to work with the provider
down.

---

#### GET /today/insight
**Requires Authentication** — the coach's sentence about today. **Always 200.**

```json
{
  "text": "Low energy is information, not a verdict. The smallest version still counts today.",
  "source": "template",
  "generatedAt": "2026-03-02T09:00:00.000Z"
}
```

`source: "template"` means the coach was unavailable — no key, provider down, a
response that failed the schema — and this is the deterministic sentence keyed to
the intervention mode the engine already resolved. It is not an error and not an
apology: a coaching card is the wrong place to learn about an expired API key.

Cached per user per local day, **in process**. Stated rather than hidden: with
several API instances a user can see one regeneration per instance per day. A
check-in invalidates the entry, because a user who just said "low energy" and
still reads yesterday's chirpy sentence would reasonably conclude nothing
listened.

---

#### POST /today/check-in
**Requires Authentication** — "How does today feel?" (PRD §73). **200.**

```json
{ "feel": "LOW_ENERGY" }
```

`feel` is one of `NORMAL`, `PACKED`, `LOW_ENERGY`, `UNEXPECTED_PROBLEM`. **One
field, and that is the whole design** — PRD §73 also says to avoid "daily
emotional interrogation", and the guard against that is structural: there is
nowhere in this body to put a follow-up question.

**Upsert, not insert.** The question is asked once a day and the answer can
change — a morning that started fine can become a packed afternoon — so a history
of taps would be noise. The unique index on `(user_id, date_local)` is what makes
"one answer per day" a property of the data rather than of the caller.

`date_local` is stored as `YYYY-MM-DD` **text**, resolved in the user's own
timezone. Not a `date` column: it is a label in their zone, and a date mapping
round-trips through UTC, which would file a 19:00 check-in in Costa Rica under
the following day.

Answering also **invalidates today's cached coach insight** — a user who just
said "low energy" and still reads this morning's chirpy sentence would reasonably
conclude nothing listened.

**Response:** `{ "dateLocal": "2026-03-02", "feel": "LOW_ENERGY", "updatedAt": "…" }`

Audit: `today:check_in` with `meta: { dateLocal, feel }`.

---

#### GET /today/check-in
**Requires Authentication** — today's check-in, or `null`. Null is the normal
state: most days start there.

---

#### POST /today/reflection
**Requires Authentication** — "Anything EvolvePath should learn from today?"
(PRD §74). **201.**

```json
{ "quickOption": "TOO_MUCH", "text": "evenings are chaos" }
```

`quickOption` is one of `PLAN_WORKED`, `TOO_MUCH`, `BAD_TIMING`,
`UNEXPECTED_CONFLICT`, `LOW_ENERGY`, `AVOIDED`, `OTHER`. It is the **structured**
half — what the weekly review groups on — and `text` is the user's own words,
which never reach an audit row or a log line.

Deliberately **not** the same enum as a commitment's `SkipReason`, even though
five of the seven overlap: `PLAN_WORKED` is a real answer about a day and is not
a reason to skip anything, and merging the two would either smuggle it into the
skip menu or lose it here.

Stored as a `Reflection` with `relatedType: "day"` — E02's soft `relatedType` /
`relatedId` pointer exists for exactly this, so a day reflection is not a second
table. `relatedId` stays **null**: a day has no row to point at, and the column
is a uuid. The day is recovered from `createdAt` against the user's own day
bounds, which is also the honest answer — for an end-of-day prompt, "which day is
this about" and "when was it written" are the same question.

`friction_tags` carries the option and **nothing else**. Several reflections per
day are allowed; a user may come back with more to say.

Audit: `today:reflection` with `meta: { dateLocal, quickOption }`.

---

#### GET /today/reflection
**Requires Authentication** — today's latest day reflection, or `null`.

---

#### Commitments

A commitment is one intended action at one time, in three sizes (PRD §57 /
VISION Part III §15): the full version, a shorter one for a tight day, and the
minimum that still counts.

**The transition matrix.** A commitment's status changes *only* through
`POST /commitments/{id}/transition`, and only along these edges:

| From | May move to |
|------|-------------|
| `PLANNED` | `READY`, `STARTED`, `COMPLETED`, `PARTIALLY_COMPLETED`, `RESCHEDULED`, `SKIPPED`, `MISSED`, `CANCELLED` |
| `READY` | `PLANNED`, `STARTED`, `COMPLETED`, `PARTIALLY_COMPLETED`, `RESCHEDULED`, `SKIPPED`, `MISSED`, `CANCELLED` |
| `STARTED` | `COMPLETED`, `PARTIALLY_COMPLETED`, `RESCHEDULED`, `SKIPPED`, `CANCELLED` |
| `COMPLETED`, `PARTIALLY_COMPLETED`, `RESCHEDULED`, `SKIPPED`, `MISSED`, `CANCELLED` | *nothing — terminal* |

A status never transitions to itself: re-applying one is not a transition, and
treating it as one would make a double-tapped button write a second audit row
and move `startedAt`.

Four edges are the way they are on purpose:

- **`PLANNED → STARTED` is direct.** PRD P4 ("start matters") wants the start
  recorded whenever it happens; a mandatory `READY` step would make the product
  either invent one or lose the fact that the user started.
- **`PLANNED → COMPLETED` is legal** (added with the action endpoints below).
  Most of what a user does happens away from the app: they went for the run and
  then opened their phone. Requiring a start first would force the product to
  choose between refusing an honest "I did it" and *manufacturing* a start —
  writing a `startedAt` and an `APP_FLOW started` evidence row for something it
  never observed. PRD §10.9 rules the second one out, so the matrix allows the
  jump and no start evidence is written: `startedAt` stays null, which is itself
  the honest record that the timer was never used.
- **Everything past `STARTED` is terminal.** An honest record of a day is what
  the user did, and an "undo" would make evidence untrustworthy. To change your
  mind, create a new commitment — the old one stays as history (PRD §103).
- **`STARTED` cannot become `MISSED`.** Started-and-unfinished is
  `PARTIALLY_COMPLETED` or `SKIPPED`, both of which the user chooses. `MISSED`
  is for a commitment whose time passed untouched.

Every commitment in every response carries `allowedTransitions` computed from
this matrix, so a UI that renders exactly what the server sent can never offer
a move the API refuses.

---

#### GET /commitments
**Requires Authentication** — commitments in a time window, ordered by
`scheduledStart`.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO 8601 with offset | **Required.** |
| `to` | ISO 8601 with offset | **Required.** At most **62 days** after `from` — two of the longest months, which covers "this month and next". Beyond that a client is exporting, not rendering. |
| `domain` | enum | `WORK` \| `FAMILY` \| `HEALTH` |
| `status` | CSV | e.g. `PLANNED,READY`. CSV rather than repeated keys because Fastify parses `?status=A` as a string and `?status=A&status=B` as an array; one spelling avoids a schema that breaks on the other. |
| `outcomeId`, `planVersionId` | uuid | |

---

#### POST /commitments
**Requires Authentication** — create a commitment. **201**.

**Request Body:**
```json
{
  "domain": "HEALTH",
  "title": "Upper A",
  "scheduledStart": "2026-02-10T06:30:00.000Z",
  "scheduledEnd": "2026-02-10T07:15:00.000Z",
  "importance": 4,
  "commitmentType": "workout",
  "outcomeId": "3f2a…",
  "planVersionId": "c4d8…",
  "routineId": "e5f6…",
  "fullVersion": "Full upper-body session, 5 exercises",
  "shortVersion": "Bench and rows only",
  "minimumVersion": "10-minute circuit",
  "fullMinutes": 38,
  "shortMinutes": 20,
  "minimumMinutes": 10,
  "userConfirmed": false
}
```

The three sizes are a **title plus a duration**: `fullVersion` is what it is
called, `fullMinutes` is how long it takes. Two fields rather than a nested
object because the next-best-action sizer reads the minutes for every candidate
on every Today request, and because `PATCH` over a flat shape can change one of
the six without restating the others.

Whichever of them are present must satisfy **`minimumMinutes ≤ shortMinutes ≤
fullMinutes`** (**400** otherwise, with the offending field named). A "short
version" that takes longer than the full one is not a smaller option, it is a
typo — and the sizer would happily offer it to someone who just said they were
depleted. A `PATCH` naming one size is never rejected for a size it did not
mention.

`domain`, `title` and `scheduledStart` are required; `scheduledEnd` must be
after `scheduledStart`; `importance` defaults to `3`.

The three foreign ids must be **owned by the caller** (404 otherwise) **and
consistent with each other** (400): the plan version must belong to the
outcome's plan, the routine to that version, and a routine cannot be supplied
without its version. The plan version must be `ACTIVE` or `DRAFT` (**409**
otherwise) — a commitment derived from a superseded plan is work the user
already decided to stop doing.

**This writes no evidence.** A commitment is a plan; PRD §10.9 forbids the
product from treating a planned item as evidence that anything happened.

Audit: `commitment:create`.

---

#### GET /commitments/{id}
**Requires Authentication** — one commitment plus its `evidence` and
`reflections` arrays.

---

#### PATCH /commitments/{id}
**Requires Authentication** — edit `title`, `scheduledStart`/`scheduledEnd`,
`importance`, `commitmentType`, the three versions, or `userConfirmed`.

**`status` is not a field here.** A client sending it has the key stripped, and
the resulting empty patch is a **400**. There is exactly one way to move a
commitment's status, and it validates the matrix.

**409** when the commitment is in a terminal status — it is the record of a day
that already happened. Also **409** if the merged schedule is invalid (moving
only the start past an unchanged end).

---

#### POST /commitments/{id}/transition
**Requires Authentication** — the only way a status changes. **200**.

**Request Body:**
```json
{
  "to": "COMPLETED",
  "reason": "Travelling",
  "rescheduleTo": "2026-02-12T06:30:00.000Z",
  "evidence": {
    "evidenceType": "completion",
    "quantitativeValue": 45,
    "quantitativeUnit": "minutes",
    "qualitativeValue": "Finished all sets"
  }
}
```

| Field | When |
|-------|------|
| `to` | Always. Must be reachable from the current status. |
| `reason` | Recorded as `skipReason` on a `SKIPPED` transition. |
| `rescheduleTo` | **Required** for `RESCHEDULED`, **rejected** for anything else, and must be in the future. |
| `evidence` | Allowed **only** with `COMPLETED` or `PARTIALLY_COMPLETED`. Attaching it to a skip would be the product asserting a fact the user never made. |

**Response:**
```json
{
  "data": {
    "commitment": { "…": "the commitment after the transition" },
    "rescheduledTo": null,
    "evidence": { "id": "…", "source": "USER_LOG", "evidenceType": "completion" }
  }
}
```

Semantics:

- **`STARTED`** stamps `startedAt`, but only the first time — a second start
  would rewrite when the user actually began.
- **`COMPLETED` / `PARTIALLY_COMPLETED`** stamp `completedAt`. **No evidence
  row is created unless `evidence` was supplied**: completion is a *status*,
  evidence is what the user chose to *log*. The row is always `USER_LOG`, and
  its `evidenceType` defaults to `completion` or `partial` to match.
- **`RESCHEDULED`** closes this commitment (terminal — it keeps its evidence)
  and opens a **new** `PLANNED` commitment at `rescheduleTo`, copying the title,
  importance, links and the three versions, preserving the original's duration,
  with `rescheduledFromId` set and **`rescheduleCount` incremented**. The count
  travels with the *intention*, not the row, so "moved twice" is readable on the
  live commitment — which is the one E07's avoidance detection looks at.

All of it happens in one transaction, so a reschedule can never leave the
original closed with nothing opened in its place.

**409 on a forbidden move.** The body's `code` is `CONFLICT` (this API derives
`code` from the HTTP status — see the Error Codes section), and the
machine-readable discriminator is in `details`:

```json
{
  "statusCode": 409,
  "code": "CONFLICT",
  "message": "Cannot move a COMPLETED commitment to STARTED",
  "details": { "reason": "INVALID_TRANSITION", "from": "COMPLETED", "to": "STARTED" }
}
```

Audit: `commitment:transition` with `meta: { from, to, rescheduleCount,
rescheduledToId, evidenceId }`.

---

#### Commitment actions

`POST /commitments/{id}/transition` can express the status changes a user
makes, but it cannot express the **intent** — and the intent is what decides
which evidence gets written. "I finished" and "I gave up on the full version
and did the minimum" are the same status and different facts.

So these ten routes each name one user intent. Each owns three things the
transition endpoint has no opinion about: the timer columns, the evidence row,
and the audit action. Every one of them returns a **commitment card** (the same
shape `GET /today` uses), and every one answers **404** — never 403 — for an id
that is not the caller's.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/commitments/{id}/actions` | — | 200 card **+ `whyItMatters`** |
| POST | `/commitments/{id}/actions/start` | `{ minutes? }` | 200 card |
| POST | `/commitments/{id}/actions/pause` | — | 200 card |
| POST | `/commitments/{id}/actions/continue` | `{ extraMinutes? }` | 200 card |
| POST | `/commitments/{id}/actions/complete` | `{ notes?, minutesSpent? }` | 200 card |
| POST | `/commitments/{id}/actions/partial` | `{ notes?, minutesSpent? }` | 200 card |
| POST | `/commitments/{id}/actions/fallback` | `{ version: "short" \| "minimum" }` | 200 card |
| POST | `/commitments/{id}/actions/reschedule` | `{ scheduledStart, scheduledEnd? }` | 200 card of the **new** row |
| POST | `/commitments/{id}/actions/skip` | `{ reason, text? }` | 200 card |
| POST | `/commitments/{id}/actions/decompose` | `{ hint? }` | 200 proposal — **writes nothing** |
| POST | `/commitments/{id}/actions/decompose/apply` | the proposal | 201 card of the **new** commitment |

**The card.**

```json
{
  "id": "5a2b…",
  "title": "Draft the proposal storyline",
  "domain": "WORK",
  "status": "STARTED",
  "scheduledStart": "2026-03-01T09:00:00.000Z",
  "scheduledEnd": null,
  "durationMinutes": 25,
  "versions": {
    "full": { "title": "Draft the storyline", "minutes": 25 },
    "short": { "title": "Write the decision statement", "minutes": 10 },
    "minimum": { "title": "Open the doc and write one sentence", "minutes": 5 }
  },
  "importance": 5,
  "rescheduleCount": 0,
  "startedAt": "2026-03-01T09:00:00.000Z",
  "completedAt": null,
  "versionUsed": null,
  "minutesSpent": null,
  "outcomeId": "3f2a…",
  "decomposedFromId": null,
  "steps": null,
  "timer": {
    "activeSince": "2026-03-01T09:00:00.000Z",
    "activeSeconds": 0,
    "elapsedSeconds": 600,
    "timerMinutes": 25,
    "remainingSeconds": 900
  },
  "availableActions": ["pause", "complete", "partial", "fallback", "skip", "decompose"]
}
```

`versions.full` always exists — a commitment with no declared sizes is its own
full version. `short` and `minimum` are `null` unless they were actually
declared: inventing a short version would let the product offer a smaller
commitment the user never agreed to. Minutes come from the `*Minutes` columns,
then from the scheduled window for `full`, then from a 25-minute default.

**The timer is server-derived.** `activeSeconds` is time banked at the last
pause and `activeSince` is when the current run began (`null` while paused);
`elapsedSeconds` is the sum, computed at read time. Nothing stores the elapsed
value, so a reloaded page, a second device and a phone that slept all agree —
and a client clock cannot inflate the record. **There is no `PAUSED` status**:
paused is `STARTED` with `activeSince: null`.

**`availableActions` is the list the client renders.** Computed from the matrix
plus the timer, because `pause` and `continue` are the same button to a user and
different operations to the server. A client running an older bundle would
otherwise offer a move this API refuses.

Semantics worth stating:

- **`GET /commitments/{id}/actions`** is what an execution screen reads: the
  same card every action returns, plus `whyItMatters` (the outcome's motivation,
  falling back to its definition of done). Separate from `GET /commitments/{id}`,
  which is the *record* — every column, its evidence and its reflections. Two
  shapes on one screen is how a UI drifts from an API one field at a time.
- **`start`** stamps `startedAt` (first time only), sets `activeSince`, and
  writes `APP_FLOW started`. A start on a *paused* commitment resumes it rather
  than erroring — to a user there is one button. Any other timer the user left
  running is paused first, with its own `paused` evidence: **one running timer
  per user**, because two commitments claiming the same wall-clock minutes would
  make every later "how long did this take" answer a lie.
- **`continue`** is accepted **while the timer is still running**, which is the
  one place the action set is wider than `availableActions`. A session that has
  passed its target is still `STARTED` with `activeSince` set, and that is
  exactly when the Start screen offers "Continue another 15?" — refusing it
  would leave the user's only way forward a pause followed by a continue, which
  writes a `paused` evidence row for a pause that never happened (PRD §10.9).
  When it is already running, `activeSince` is left alone so no accumulated time
  is lost; only the target moves.
- **`complete` / `partial`** fold the running time into `activeSeconds`, stamp
  `completedAt`, and set `minutesSpent` from the body or, failing that, from the
  timer. `versionUsed` defaults to `FULL`. The evidence row is `USER_LOG` with
  `qualitativeValue` carrying `{ notes, versionUsed, fallbackUsed }`.
- **`fallback`** changes no status. It records *which size the user is
  attempting*, at the moment they decide — PRD §101's "Evidence: fallback
  completed" needs that decision. **400 `VERSION_NOT_DEFINED`** for a size the
  commitment never declared.
- **`reschedule`** delegates to the transition matrix and returns the card of
  the **new** row. `RESCHEDULED` is terminal, so **use the returned `id` from
  here on**. The `rescheduled` evidence row is written on the new commitment: the
  live intention carries its own move history, and the closed row keeps only what
  happened before it moved. **409 `ALREADY_STARTED`** for a commitment whose
  timer has been running — its evidence belongs to today.
- **`skip`** writes a `Reflection` with `frictionTags: [reason]`, **not
  evidence**: a skip is not execution, and recording it as evidence would make
  "what did you do this week" include the things you did not do. `reason` is one
  of `TOO_MUCH`, `BAD_TIMING`, `UNEXPECTED_CONFLICT`, `LOW_ENERGY`, `AVOIDED`,
  `OTHER`. The audit row carries the enum and never the text.
- **`decompose`** asks the `coach` persona for 3–5 steps whose first is ≤ 10
  minutes, and **mutates nothing** (PRD §15: AI output is not persisted without
  the user's approval). When the coach is unavailable it answers **200** with
  `source: "template"` and a real five-minute first move — PRD §120 requires the
  deterministic path to keep working.
- **`decompose/apply`** creates a **new** commitment from `firstStep`, linked by
  `decomposedFromId`, with the steps persisted. The original is left alone: it
  is still in the plan, and the small one is today's move.

Audit: `commitment:start`, `:pause`, `:continue`, `:complete`, `:partial`,
`:fallback`, `:reschedule`, `:skip`, `:decompose_apply`.

---

#### Evidence

What actually happened, as opposed to what was planned.

#### POST /evidence
**Requires Authentication** — log a fact. **201**.

**Request Body:**
```json
{
  "commitmentId": "5a2b…",
  "evidenceType": "completion",
  "source": "USER_LOG",
  "occurredAt": "2026-02-10T07:15:00.000Z",
  "quantitativeValue": 45,
  "quantitativeUnit": "minutes",
  "qualitativeValue": "Finished all sets",
  "confidence": 1
}
```

**`source` must be `USER_LOG`.** The schema declares it as a literal, not the
full enum. `TIMER`, `WORKOUT_LOG` and `APP_FLOW` mean *"the system observed
this"*, and a client able to claim them could manufacture observations — which
is exactly what PRD §10.9's "the product should not pretend planned calendar
events are completion evidence" is about. Those sources are written only by
server-side flows (the Start flow, focus sessions, the workout runner), through
a service method no route exposes.

`commitmentId` is optional (evidence can stand alone) but must be owned when
given (**404**).

---

#### GET /evidence
**Requires Authentication** — evidence in a time window, newest first.

`from` and `to` are required; the window is capped at **93 days** — wider than
the commitment window, because evidence is what momentum is read from. Filters:
`commitmentId`, `source`, and `domain` (which resolves through the evidence's
commitment, so unattached rows are excluded — they have no domain to match).

---

#### DELETE /evidence/{id}
**Requires Authentication** — **204**. PRD §127: the user controls their own
record, including deleting it. Another user's row is **404**.

---

#### Reflections

Optional, lightweight notes and scores. `relatedType` is a soft pointer rather
than four nullable foreign keys, so reflections can attach to whatever the
product grows next without a migration on the table.

#### POST /reflections
**Requires Authentication** — **201**.

**Request Body:**
```json
{
  "relatedType": "commitment",
  "relatedId": "5a2b…",
  "userText": "Harder than expected, but the minimum version got me there",
  "frictionTags": ["late start", "low energy"],
  "mood": 3,
  "perceivedDifficulty": 4,
  "satisfaction": 4
}
```

`relatedType` is `commitment` \| `outcome` \| `plan_version` \| `day`.
`relatedId` is **required for every type but `day`** and must be the caller's
row (**404** otherwise) — nothing in the database checks a soft pointer, so the
check is here or nowhere.

A reflection with no note, no friction tag and no score is **400**: an empty row
would make "how many times did you reflect?" meaningless.

---

#### GET /reflections
**Requires Authentication** — newest first, capped at 200. Filters:
`relatedType`, `relatedId`, `from`, `to`.

---

#### EvolvePath errors

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` | Zod rejected the body, query or path parameter. `details` carries the failing paths. |
| 401 | `UNAUTHORIZED` | No bearer token, or an expired one. |
| 404 | `NOT_FOUND` | The id is unknown **or** belongs to another user — deliberately indistinguishable. |
| 409 | `CONFLICT` | A state-machine violation: an edit to an archived outcome, a second plan for one outcome, a second draft, an activate/edit/reject on the wrong version status, a write to a read-only version's routines, a losing activation race, an edit to a terminal commitment, or a commitment hung off a superseded plan version. The message names the current status. |
| 409 | `CONFLICT` with `details.reason = "INVALID_TRANSITION"` | A commitment transition the matrix forbids. `details` also carries `from` and `to`. |

---

### Progress

Momentum, the consistency run, recovery and the evidence timeline (epic E11).

**There is no score in this response, and its absence is the design** (PRD P13,
§54). Every number is a count. The engine compares ratios internally to detect a
trend and deliberately does not serialise them: a ratio on the wire is one pull
request away from a percentage badge. The only `ratio` in the payload is
`independence.ratio`, which measures the product — how often the user acts
without being reminded — not the person.

Deterministic and AI-free: the same data yields the same states, and the screen
renders with the provider down (PRD §53, §120).

---

#### GET /progress
**Requires Authentication** — the caller's own evolution. There is no id in the
path; a user reads their own Progress or nobody's.

```json
{
  "generatedAt": "2026-03-02T12:00:00.000Z",
  "windowDays": 28,
  "momentum": {
    "HEALTH": {
      "domain": "HEALTH",
      "state": "STEADY",
      "evidence": [
        "5 of 6 planned workouts completed",
        "1 completed with the short or minimum version"
      ],
      "signals": {
        "planned": 6, "completed": 5, "partial": 0, "fallback": 1,
        "missed": 1, "skipped": 0, "consecutiveMisses": 0, "rescheduledTwice": 0,
        "lastCompletionAt": "2026-03-01T13:00:00.000Z",
        "lastMissAt": "2026-02-20T13:00:00.000Z",
        "returnedAfterIdleDays": null
      },
      "trend": [
        { "weekStart": "2026-02-09", "planned": 3, "completed": 3 },
        { "weekStart": "2026-02-16", "planned": 3, "completed": 2 },
        { "weekStart": "2026-02-23", "planned": 3, "completed": 3 },
        { "weekStart": "2026-03-02", "planned": 1, "completed": 1 }
      ]
    },
    "WORK":   { "…": "same shape" },
    "FAMILY": { "…": "same shape" }
  },
  "consistencyRun": {
    "weeks": 3,
    "graceUsed": 1,
    "weekly": [
      { "weekStart": "2026-02-09", "planned": 6, "completed": 5, "success": true, "graced": false, "current": false }
    ]
  },
  "recovery": { "medianDays": 1.5, "samples": 4 },
  "independence": { "ratio": null, "completedWithoutReminder": 0, "sampleSize": 0 },
  "milestones": [
    { "id": "…", "kind": "FIRST_COMEBACK", "sequence": 1, "domain": null,
      "achievedAt": "2026-03-05T18:00:00.000Z", "acknowledgedAt": null,
      "title": "First comeback", "body": "You returned.", "meta": {} }
  ],
  "insights": [
    { "id": "9c1…", "category": "PATTERN", "statement": "Mornings work better than evenings" }
  ]
}
```

**The six momentum states**, resolved by the FIRST matching rule — the order is
part of the contract:

| # | State | Rule |
|---|-------|------|
| 1 | `INSUFFICIENT_DATA` | fewer than 3 decided commitments in the window |
| 2 | `RECOVERING` | the latest completion ended a gap of 3+ days that contained a miss |
| 3 | `SLIPPING` | 3 not-started in a row, or the recent half fell 0.15 below the prior half |
| 4 | `BUILDING` | the user is under 14 days old in this domain and keeping at least half |
| 5 | `IMPROVING` | the recent half rose 0.15 above the prior half |
| 6 | `STEADY` | otherwise |

`RECOVERING` beats `SLIPPING` on purpose: a person who came back deserves to
read that they came back, not that they lapsed (VISION §31).

**What counts.** A commitment is *decided* when it is `COMPLETED`,
`PARTIALLY_COMPLETED`, `MISSED`, `SKIPPED`, or still `PLANNED`/`READY` with its
time already past — so the numbers are the same before and after the inactivity
sweep closes a stale row. `CANCELLED` (removed by a plan change) and
`RESCHEDULED` (closed by a reschedule whose successor carries the intention) are
excluded entirely: neither a plan edit nor a postponement is a failure. A
completion at the SHORT or MINIMUM size is a completion (PRD §44).

**The run is counted in weeks, not days** (PRD §55). A week succeeds at 60% of
what was planned; a week with nothing planned is neutral and neither extends nor
breaks the run; one bad week per four counted weeks is forgiven, and `graceUsed`
says so out loud. The week in progress is reported with `current: true` and
never counted. Weeks are Monday-start in the user's own timezone, the same
convention the family summary and the weekly review use.

**`independence.ratio` is `null` until epic E12** records which completions
followed a reminder. Null rather than zero, so a client can say "available once
notifications learn your rhythm" instead of reporting a failure that has not
been measured.

---

#### GET /progress/timeline
**Requires Authentication** — what actually happened, newest first.

Query: `from` (default `now − 28d`), `to` (default now), `domain`, `limit`
(1–200, default 100), `cursor`. A range over **186 days** is a 400
`RANGE_TOO_LARGE`, not a silent truncation: a client asking for two years is
asking the wrong question, and quietly answering six months of it would look
like the user's history had a hole in it.

```json
{
  "items": [
    { "id": "…", "at": "2026-03-05T07:42:00.000Z", "kind": "started_after_postpone", "significance": "notable",
      "domain": "WORK", "title": "Started the proposal after 2 postponements", "detail": null,
      "commitmentId": "…", "milestoneId": null },
    { "id": "…", "at": "2026-03-04T19:10:00.000Z", "kind": "family_kept", "significance": "notable",
      "domain": "FAMILY", "title": "Protected family dinner", "detail": null, "commitmentId": "…", "milestoneId": null },
    { "id": "…", "at": "2026-03-04T07:05:00.000Z", "kind": "completed_fallback", "significance": "ordinary",
      "domain": "HEALTH", "title": "Completed Upper A — minimum version", "detail": null, "commitmentId": "…", "milestoneId": null }
  ],
  "nextCursor": "MjAyNi0wMy0wNFQwNzowNTowMC4wMDBafGU3"
}
```

**The mapping is a whitelist, not a rename.** PRD §76 asks for *meaningful*
events. The evidence table also records `paused`, `continued`, `rescheduled` and
`fallback_selected`; a timeline showing them would be a log rather than a story
("paused at 14:32, continued at 14:41" is true and tells the user nothing they
want to know about themselves). A row with no rule below produces no event.

| Source row | `kind` | `significance` | Title |
|---|---|---|---|
| `completed` evidence | `completed` | ordinary | "Completed {title}" |
| …with `versionUsed` SHORT/MINIMUM | `completed_fallback` | ordinary | "Completed {title} — minimum version" |
| …in FAMILY | `family_kept` | notable | "Protected {title}" |
| `partially_completed` evidence | `partially_completed` | ordinary | "Made progress on {title}" |
| `started` evidence, `rescheduleCount ≥ 2` | `started_after_postpone` | notable | "Started {title} after {n} postponements" |
| a success ending a run of misses in its domain | `returned_after_miss` | notable | "Returned to {Domain} plan after {k} missed" |
| `plan:change_accepted` audit row | `plan_change_accepted` | notable | "Plan updated to v{n}" (detail = the version's rationale) |
| `recovery` evidence | `comeback_completed` | notable | "Back on Path" |
| a `milestones` row | `milestone` | milestone | the milestone's own copy |

A **fallback completion is a completion** (PRD §44) — labelled, never
diminished. A FAMILY completion is "protected", never "completed": VISION §12 is
clear the family domain is not a scoreboard.

`significance` is a property of the payload rather than of the API, so
"significant" has one definition instead of one per screen. PRD §77's "avoid
constant confetti": a client shows a `milestone` once as a toast, highlights a
`notable`, and renders an `ordinary` plainly.

The plan-change rationale is **joined from `plan_versions`, not copied into the
audit meta** — PRD §80's reason belongs to the plan, and a second copy is the one
that goes stale after an edit.

Pagination is a `base64url` cursor of `at|id`. Ordering is newest-first with
ties broken by id, which is what lets it promise no duplicates and no gaps.

---

#### GET /progress/milestones
**Requires Authentication** — newest first, at most 50.
`?unacknowledged=true` returns only what the user has not been shown yet.

```json
{
  "items": [
    { "id": "…", "kind": "TEN_WORKOUTS", "sequence": 2, "domain": "HEALTH",
      "achievedAt": "2026-03-05T07:42:00.000Z", "acknowledgedAt": null,
      "title": "20 workouts completed", "body": "Thirty days ago those were intentions.",
      "meta": { "count": 20 } }
  ]
}
```

The six kinds (PRD §55), and when each is awarded:

| Kind | Repeats | Awarded when |
|---|---|---|
| `FIRST_FULL_WEEK` | no | any week has ever succeeded |
| `FOUR_WEEKS` | yes, `sequence n` | the consistency run reaches `4n` weeks |
| `TEN_WORKOUTS` | yes, `sequence n` | `10n` HEALTH workout completions |
| `FIRST_COMEBACK` | no | the first `recovery` evidence row |
| `FIRST_START_AFTER_POSTPONE` | no | a start on something moved twice or more |
| `REDUCED_REMINDERS` | no | independence ≥ 0.7 over ≥ 10 samples — **dormant until epic E12** measures it |

`sequence` is why the two repeatable kinds are not booleans: the fourth
four-week stretch is a genuinely different fact from the first, while "ten
workouts" said twice is the confetti PRD §77 rules out. The unique
`(user_id, kind, sequence)` index is the idempotency — the detector runs after
every start, every completion, every comeback and once a day, and
`createMany({ skipDuplicates: true })` turns a re-award into a no-op at the
database rather than in a code path somebody could forget.

`REDUCED_REMINDERS` cannot fire while `independence.ratio` is `null`, which it
is until E12-06 supplies the reader. The kind exists now so the detector, the
copy and the timeline are complete; no flag is needed to keep it quiet.

#### POST /progress/milestones/{id}/ack
**Requires Authentication** — marks it seen, so it is celebrated once. Idempotent;
a foreign or unknown id answers 404, identically.

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` | `RANGE_TOO_LARGE` (over 186 days) or `BAD_CURSOR`. |
| 401 | `UNAUTHORIZED` | No bearer token, or an expired one. |
| 404 | `NOT_FOUND` | The milestone is unknown **or** belongs to another user. |

---

### Comeback

Returning after a pause (epic E11). PRD §56–§57, §109, §136; VISION §32–§33.

**There is no route here that reports what the user missed, and there never
should be.** That is the feature, not an omission. A person who disappears for
four days is not met by a red overdue list: the sweep turns stale intentions
into history, and this section offers exactly one small thing to do next.

The sweep runs daily at 04:00 and **changes commitment status only** — every
`evidence_items` row is left exactly as it was. Prior misses remain evidence
(PRD §109); closing an intention is not editing a history. A `STARTED` row is
never closed, because the transition matrix has no `STARTED → MISSED` and should
not: something you began and did not finish is `PARTIALLY_COMPLETED` or
`SKIPPED`, and only the user knows which.

---

#### GET /comeback
**Requires Authentication** — the caller's own open loop.

```json
{
  "state": "OFFERED",
  "trigger": "INACTIVITY",
  "offeredAt": "2026-09-06T04:00:00.000Z",
  "idleDays": 4,
  "closedCount": 3,
  "planReviewSuggested": false,
  "restart": { "id": "…", "title": "12-minute bodyweight circuit", "…": "a CommitmentCard" },
  "recommendation": { "domain": "HEALTH", "reason": "You were keeping health going before the pause, so it is the easiest to rebuild." },
  "alternatives": [
    { "domain": "WORK", "title": "Morning focus block", "minutes": 10 }
  ],
  "wording": { "note": "No catching up. We start from today." }
}
```

When `state` is `NONE`, everything but `state` and `planReviewSuggested` is null
or empty. `closedCount` is a **count**, never a list.

**How the one restart is chosen** — a pure function, in this order:

1. Domains in `PAUSE` are excluded outright. The user put them down deliberately.
2. Highest outcome importance.
3. Tie → the domain with the most recent completion. VISION §32 rebuilds what was
   already working; a return is not the moment to introduce a new habit.
4. Tie → the fixed order `HEALTH, WORK, FAMILY`.

The title is the routine's own fallback wording where it has one, and the
duration is clamped to **10–15 minutes** — small enough to be winnable on the
first day. A user with no active routine still gets an offer: a ten-minute walk,
which needs no plan behind it.

The coach may reword the title and note (`coach` persona, prompt version
`comeback-restart.v1`). It never chooses the behaviour, the domain or the
duration — those are already decided when it is called. Its output is checked
against a banned-word list (`overdue`, `behind`, `failed`, `streak`, and
"catching up" without its negation) and discarded whole on a match. Asking a
model not to shame somebody is a request; checking is a guarantee, and the
deterministic copy ships on every provider outage.

---

#### POST /comeback/choose
**Requires Authentication** — `{ "domain": "WORK" }`. Cancels the offered
restart through the transition matrix and creates one for the named domain.
Returns the same `ComebackStatus`.

- 409 `NO_COMEBACK_OFFER` when nothing is open
- 400 `NO_RESTART_IN_DOMAIN` when that domain has no active routine to rebuild

#### POST /comeback/start
**Requires Authentication** — marks the loop `IN_PROGRESS`. The client then
navigates to `/start/<restart.id>`, which is the ordinary full-screen execution
route; there is deliberately no comeback-specific timer.

#### POST /comeback/complete
**Requires Authentication** — `{ "notes": "…" }` (optional).

```json
{
  "celebration": { "title": "Back on Path.", "body": "The important part was not that you missed. It was that you returned." },
  "evidenceId": "…",
  "milestone": { "kind": "FIRST_COMEBACK", "…": "on the first return only, else null" },
  "nextCommitment": { "…": "a CommitmentCard, or null" },
  "planReviewSuggested": false
}
```

The restart is completed through the ordinary commitment action service, so it
earns the same `completed` evidence and audit row any other completion does — a
comeback is a real thing the user did, not a special case in the history. One
`recovery` row (`source: APP_FLOW`) is then written on top of it.

**Idempotent by refusal**: a second call is a 409 `NO_COMEBACK_OFFER`, never a
second recovery row.

#### POST /comeback/dismiss
**Requires Authentication** — 204. PRD §127: the user is allowed to decline being
helped. Cancels the restart row and closes the loop; the next sweep may offer
again.

---

**`planReviewSuggested`** is raised when the misses look like plan drift rather
than a bad week — four or more misses in fourteen days, or five or more rows
closed by one sweep. It is a **flag and a link**, never a plan change: PRD §15
means nothing in this module writes a `PlanVersion`.

**What counts as activity** (and so resets the three-day clock): a commitment
acted on, evidence logged, a check-in, a day reflection, a coaching turn.
Opening the app is not activity. PRD §57 counts behaviour, because a person who
opens the app every morning and does nothing has not been active in any sense
worth protecting them from a kind sentence over.

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | No bearer token, or an expired one. |
| 400 | `BAD_REQUEST` | Zod rejected the body, or `NO_RESTART_IN_DOMAIN`. |
| 409 | `CONFLICT` with `details.reason = "NO_COMEBACK_OFFER"` | There is no open loop. |

---

### Work

The Work domain (epic E07): turning an outcome into sessions somebody actually
starts. Full rationale, the ladder rule and the rejected alternatives are in
[`docs/specs/work-domain.md`](specs/work-domain.md).

Every route is a per-user resource — plain bearer auth, ownership resolved by
the caller's id, and **404, never 403**, for an id that belongs to somebody
else. A non-`WORK` outcome or commitment answers **400** with
`details.reason = "OUTCOME_NOT_WORK"` / `"COMMITMENT_NOT_WORK"`: it exists and
is yours, it is simply not what this endpoint is for.

#### Session planning

**Nothing is written to the plan until `apply`.** `POST .../plan-sessions`
creates exactly one `work_session_plan_proposals` row and no commitment,
milestone, routine or plan version — PRD §15's rule that AI output waits on a
human. `apply` is the approval step, and it is the only path that turns a
proposal into rows.

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/outcomes/{id}/plan-sessions` | `{ targetDate?, availableMinutesPerDay? }` | 200 `{ proposalId, proposal, source: "ai", expiresAt }` |
| POST | `/api/outcomes/{id}/plan-sessions/template` | same | 200 `{ …, source: "template" }` — **never calls the model** |
| POST | `/api/outcomes/{id}/plan-sessions/apply` | `{ proposalId, proposal? }` | 201 `{ routineId, milestoneIds[], commitmentIds[] }` |
| GET | `/api/outcomes/{id}/work-plan` | — | 200 milestones, sessions, the applied intention and cadence |

`availableMinutesPerDay` resolves **request → `user_profiles.weekday_minutes` →
60**, in that order.

The plan contract (`work-session-plan.schema.ts`, also the `planner` persona's
structured-output schema, `schemaName: work_session_plan`,
`promptVersion: work-session-plan.v1`):

```ts
{
  milestones: [{ title: string, order: number }],            // 1..8
  sessions: [{                                               // 1..20
    title: string,
    scheduledStart: string,                                  // ISO-8601 with offset
    durationMinutes: number,                                 // 10..120
    milestoneIndex: number,
    minimumStart: { title: string, minutes: number },        // 2..15, required
  }],
  implementationIntention: { when: string, then: string },
  reviewCadence: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY',
  rationale: string,
}
```

The **guardrails** run over the model's output, the template, and the copy the
user edited, identically: milestone orders are `0..n-1` with no gaps; every
`milestoneIndex` is in range; every session falls between the start of today and
the target date (or 14 days out without one); at most two sessions per local
calendar day; the per-day total never exceeds `availableMinutesPerDay`; each
`minimumStart` is strictly shorter than its session; sessions are in ascending
order. A model plan that breaks one is treated as a schema failure — **nothing
is stored**, because a plan the server had to correct is not the plan the user
would be agreeing to.

Applying creates, in **one transaction**: the outcome's `Plan` + v1 when it had
none, one `work_milestones` row per milestone (orders continue from the
outcome's current maximum, so a second plan appends), one `EVENT`-triggered
`Routine` on the outcome's **current ACTIVE** plan version, and one `PLANNED`
`WORK` commitment per session with `commitment_type = 'FOCUS_SESSION'` and its
full / short / minimum versions. **No new `PlanVersion` is created** — sessions
are commitments, not a change of strategy.

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` with `details.reason = "OUTCOME_NOT_WORK"` | The outcome is FAMILY or HEALTH. |
| 400 | `BAD_REQUEST` with `details.reason = "TARGET_DATE_PAST"` | The target date is today or earlier. |
| 400 | `BAD_REQUEST` with `details.reason = "PROPOSAL_INVALID"`, `details.rules[]` | The (edited) plan breaks a guardrail. Each rule is a readable sentence. |
| 404 | `NOT_FOUND` | Unknown outcome or proposal, or one that is not the caller's. |
| 409 | `CONFLICT` with `details.reason = "PROPOSAL_NOT_PENDING"` | Already applied, discarded or expired. An expired proposal is flipped to `EXPIRED` on this read. |
| 412 | `AI_KEY_REQUIRED` | The caller has no OpenAI key. The one AI failure the user can fix. |
| 503 | `SERVICE_UNAVAILABLE` with `details = { reason: "AI_UNAVAILABLE", code, retryable }` | The provider failed. `retryable` is true for `rate_limit`/`timeout`/`network`/`provider`; use the template route either way. |

#### Focus sessions

PRD §27–§28. **This is a layer over the commitment timer, not a second one.**
Every status change and every timer column still belongs to E05's
`/commitments/:id/actions/*` — `start` on start, `continue` on extend,
`complete` / `partial` / `pause` on stop. What a focus session adds is the
thing a commitment has no column for: how long the user meant to focus, how many
times they continued, what distracted them, and how it ended.

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/focus-sessions` | `{ commitmentId, plannedMinutes: 1..180, instruction?, takeOver? }` | 201 `FocusSession` |
| GET | `/api/focus-sessions/active` | — | 200 `{ session \| null, serverNow }` |
| POST | `/api/focus-sessions/{id}/extend` | `{ minutes: 1..60 }` | 200 `FocusSession` |
| POST | `/api/focus-sessions/{id}/note` | `{ text: 1..280 }` | 200 `FocusSession` |
| POST | `/api/focus-sessions/{id}/stop` | `{ outcome: 'done' \| 'partial' \| 'abandoned', notes? }` | 200 `{ session, evidenceId, commitmentStatus, actualMinutes }` |
| GET | `/api/focus-sessions?commitmentId=&outcomeId=&from=&to=` | — | 200 `{ sessions[] }` — own rows, newest first, max 100, window ≤ 93 days |

```ts
FocusSession = {
  id, commitmentId, plannedMinutes, instruction,
  startedAt, endedAt, outcome,          // DONE | PARTIAL | ABANDONED | null
  actualMinutes, continuedCount, distractionNotes: string[],
  commitment: { title, status, timer },  // `timer` is GET /today's card timer
}
```

`commitment.timer` is E05's `commitmentCardSchema.timer` verbatim, so a client
derives the countdown with the maths it already has and nothing here duplicates
it. `serverNow` on `active` lets a phone with a skewed clock re-anchor against
the server.

**`stop` writes a `TIMER` `focus_session` evidence row for every outcome**, with
`quantitative_value` = the minutes actually focused (floored at 1) and
`qualitative_value` = the outcome. That row is distinct from the `APP_FLOW
started` row E05 wrote at the beginning: starting is recorded separately from
completing (PRD §104).

`abandoned` **pauses** the commitment rather than closing it, so the
next-best-action engine keeps offering it — and the evidence row is still
written. Ten minutes on something avoided for three days is progress
(VISION §10).

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` with `details.reason = "COMMITMENT_NOT_WORK"` | Health has its own workout runner. |
| 400 | `BAD_REQUEST` with `details.reason = "COMMITMENT_NOT_STARTABLE"` | The commitment is COMPLETED or CANCELLED. |
| 400 | `BAD_REQUEST` with `details.reason = "TOO_MANY_NOTES"` | 20 is the cap. |
| 404 | `NOT_FOUND` | Unknown session, or one that is not the caller's. |
| 409 | `CONFLICT` with `details = { reason: "FOCUS_SESSION_ACTIVE", activeSessionId, commitmentId }` | One is already running. Send `takeOver: true` to end it as ABANDONED first. |
| 409 | `CONFLICT` with `details.reason = "FOCUS_SESSION_ENDED"` | Any mutation on a session that has stopped. |

"One active session per user" is enforced in the service, **not** by a partial
unique index — a crashed client must always be able to recover through
`GET /focus-sessions/active` and take the old one over, and a database
constraint would turn that recovery into a 500.

#### Avoidance and the friction question

PRD §25–§26, VISION §9. `GET /today` carries an `avoidance` object on every
**`WORK`** commitment card and `null` on every other domain — the ladder reasons
about avoiding work, and a family dinner that moved twice is a week, not a
pattern to escalate on.

**There is no stored `avoidanceLevel` column.** The signals move overnight —
"untouched for three days" becomes four without anybody touching a row — so a
persisted level would contradict `GET /today` within hours, invisibly. It is
derived on every read from a batched query whose cost does not grow with the
number of cards.

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/commitments/{id}/avoidance` | — | 200 `AvoidanceAssessment` |
| POST | `/api/commitments/{id}/friction` | `{ answer: FrictionAnswer, text? }` | 200 `{ level, obstacleId, reflectionId, intervention }` |

```ts
AvoidanceAssessment = {
  level: 0..6,                    // PRD §26's seven rungs
  interventionType: string,       // the INTERVENTION_TYPES name for the level
  signals: string[],              // exactly the active signal keys
  rationale: string,              // deterministic, with the counts substituted
  suggestedAction: 'NONE' | 'MINIMUM' | 'DECOMPOSE'
                 | 'FRICTION_QUESTION' | 'ENVIRONMENT' | 'PLAN_REVIEW',
}
```

**A single reschedule, a single skip and a single "later" each leave the user at
level 0** (PRD §25). The full rule — six signals, their thresholds, the rungs
they carry, and the caps on levels 5 and 6 — is copied verbatim into
[`docs/specs/work-domain.md`](specs/work-domain.md) from the detector's own file
header.

The level feeds `GET /today`'s `nextBestAction.interventionMode`: `DIAGNOSE` at
3–4, `CHALLENGE_PLAN` at 5–6, `REDUCE` at 1–2. See
[`today-and-nba.md`](specs/today-and-nba.md) §6.

**The eight answers, and where each goes.** The intervention type is decided
server-side from the answer — never from the body, and never from what the model
claims:

| `FrictionAnswer` | Label | `interventionType` | `Obstacle.type` |
|---|---|---|---|
| `DONT_KNOW_WHERE_TO_BEGIN` | I don't know where to begin | `ACTIVATION_REDUCTION` | `AMBIGUOUS_WORK_TASK` |
| `TOO_BIG` | It feels too big | `DECOMPOSITION` | `TASK_TOO_LARGE` |
| `TIRED` | I'm tired | `REDUCE_SCOPE` | `LOW_ENERGY_WINDOW` |
| `DONT_WANT_TO` | I don't want to do it | `RECONNECT_REASON` | `LOW_MOTIVATION` |
| `SOMETHING_URGENT` | Something more urgent came up | `PROTECTED_RESCHEDULE` | `URGENCY_DISPLACEMENT` |
| `WORRIED_ABOUT_QUALITY` | I'm worried I won't do it well | `PERFECTIONISM_REFRAME` | `PERFECTIONISM` |
| `NEED_MORE_INFO` | I need more information | `CLARIFY` | `AMBIGUOUS_WORK_TASK` |
| `OTHER` | Other (`text` required) | `FRICTION_DIAGNOSIS` | `OTHER` |

The coach is asked for **wording**, and its reply is discarded in favour of the
deterministic template when it claims a different intervention type, recommends
more than 15 minutes, names another commitment's id, or returns a proposal or a
friction question of its own. `intervention.source` says which was used, and a
`template` answer is a complete one — every answer works with the provider down.

Free `text` goes through the safety layer **before** the model. A `redirect`
returns the professional-care copy and **writes nothing** — no reflection, no
obstacle, no gateway call.

Having answered, the card's `suggestedAction` drops from `FRICTION_QUESTION` to
`DECOMPOSE` for seven days. The question is a diagnosis, not a nag.

**The protected reschedule.** `POST /api/commitments/{id}/actions/reschedule`
takes an extra `protected?: boolean`. When the user has answered
`SOMETHING_URGENT` on that commitment within 24 hours, the move happens
normally — new row, evidence, status `RESCHEDULED` — but **`rescheduleCount`
does not grow**, because having a job is not avoidance. Sent without that
reflection it is a 400 `PROTECTED_RESCHEDULE_NOT_ALLOWED`: a flag a client could
set freely would be a way to make every move invisible to the detector.

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` with `details.reason = "COMMITMENT_NOT_WORK"` | Not a Work commitment. |
| 400 | `BAD_REQUEST` | `OTHER` with no `text`. |
| 400 | `BAD_REQUEST` with `details.reason = "PROTECTED_RESCHEDULE_NOT_ALLOWED"` | `protected: true` with no recent urgency answer. |
| 404 | `NOT_FOUND` | Unknown commitment, or one that is not the caller's. |

#### The work week

PRD §29. Deterministic and **AI-free** — E10's weekly reviewer reads these counts
as its input, which is why they are computed here: a provider outage must change
the words and never the numbers.

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/work/summary?weekStart=YYYY-MM-DD` | 200 `WorkWeeklySummary` |

`weekStart` is the user's local **Monday** and defaults to the current week —
Monday-start everywhere in this product, as E08's family summary and E10's
review already fixed.

```ts
WorkWeeklySummary = {
  weekStart, weekEnd, timezone,
  focusSessions: { planned, started, done, partial, abandoned,
                   plannedMinutes, actualMinutes },
  starts: { commitmentsDue, started, completed, startRate, completionRate },
  outcomesCompleted: [{ outcomeId, title, completedAt }],
  repeatedlyPostponed: [{ commitmentId, title, outcomeId, rescheduleCount, level }],
  timeWindows: { morning|afternoon|evening: { planned, started, completed, successRate } },
  bestWindow, worstWindow,       // null unless a window has >= 2 planned
  distractionNoteCount,
}
```

**Rates are `null`, not `0`, when nothing was planned.** "Nothing was planned"
and "nothing got done" are different weeks, and the reviewer has to be able to
tell them apart — a 0 for both produces "you completed 0% of your morning
sessions" for a week with no morning sessions in it.

Definitions worth knowing before reading a number:

- **Due** — `scheduledStart` inside `[Monday 00:00, next Monday 00:00)` in the
  user's own zone. Both edges come from `localDayBounds`, so a week containing a
  DST change is 167 or 169 hours long.
- **Started** — `startedAt` is set, **or** there is an `APP_FLOW started` or any
  `TIMER` evidence row. Starting is counted separately from completing
  (PRD §104), so a commitment somebody began and did not finish appears in
  `starts.started` and not in `starts.completed`.
- **`focusSessions.done/partial/abandoned`** — decided by the commitment's
  **latest** session: somebody who abandoned at lunchtime and finished in the
  evening finished. Every session's minutes still count towards `actualMinutes`.
- **`repeatedlyPostponed`** — `rescheduleCount >= 2`, due in the week **or**
  moved out of it. The most postponed commitment of a week is very often the one
  that was pushed past its end, which is no longer "due". `level` is its rung on
  the intervention ladder.
- **Windows** bucket by the same morning / afternoon / evening boundaries the
  ladder uses (`time-window.ts`, built on `greetingFor`), and `bestWindow` /
  `worstWindow` ignore any window with fewer than two planned — below that a
  rate is noise. A tie resolves to the earlier part of the day.

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` with `details.reason = "WEEK_START_NOT_MONDAY"` | A Tuesday. |
| 400 | `BAD_REQUEST` with `details.reason = "INVALID_WEEK_START"` | Not a readable date. |

---

### Family

The Family domain (epic E08). Every route here is a per-user resource: plain
bearer auth, ownership resolved by the caller's id, and **404 — never 403 — for
an id that belongs to somebody else**.

Two rules run through the whole section and are worth reading before the tables.

**The member record is deliberately poor.** It holds a nickname, a
relationship and an optional date-only birthday, and there is nothing else to
return. PRD §33 fixes the list; VISION §50 explains it — the people in it never
consented to being modeled, so a free-text field about them would become a
hidden assessment the moment the coach read it back. `audit_events.meta` for a
member write carries only the relationship, because an audit row outlives the
record it describes.

**A ritual is a rule, and commitments are what the product acts on.**
`GET /today`, the Path, the summary and momentum all read `Commitment` rows, so
a ritual is materialized into real commitments seven days ahead. Completing,
moving and skipping an occurrence are the ordinary commitment actions — there
are no family-specific lifecycle endpoints.

#### Family members

| Method | Path | Description |
|---|---|---|
| GET | `/api/family/members` | List, oldest first |
| POST | `/api/family/members` | Add a member |
| PATCH | `/api/family/members/{id}` | Update |
| DELETE | `/api/family/members/{id}` | Remove (204) |

```json
POST /api/family/members
{ "nickname": "Mia", "relationship": "CHILD", "birthday": "1900-09-09" }
```

```json
{
  "data": {
    "id": "0f2c…",
    "nickname": "Mia",
    "relationship": "CHILD",
    "birthday": "1900-09-09",
    "createdAt": "2026-09-05T12:00:00.000Z"
  }
}
```

`relationship` is one of `PARTNER`, `CHILD`, `PARENT`, `SIBLING`, `FRIEND`,
`OTHER`. `birthday` is a **calendar date**, never resolved through a timezone;
send `1900` as the year when it is unknown, and no consumer reads the year.
Deleting a member sets `family_member_id` to null on their rituals and
commitments — the history stays.

#### Rituals

| Method | Path | Description |
|---|---|---|
| GET | `/api/family/rituals?active=` | List; active first, then by title |
| GET | `/api/family/rituals/{id}` | One ritual plus `upcoming` (the next 7 days as commitment cards) |
| POST | `/api/family/rituals` | Create, and materialize synchronously |
| PATCH | `/api/family/rituals/{id}` | Update; may cancel and rebuild future occurrences |
| DELETE | `/api/family/rituals/{id}` | Delete (204); cancels future occurrences |
| POST | `/api/family/rituals/{id}/materialize` | Create any missing occurrences now (200) |

```json
POST /api/family/rituals
{
  "title": "Phone-free dinner",
  "purpose": "Be present at the table",
  "familyMemberId": "0f2c…",
  "recurrence": { "weekdays": [2, 4, 0], "time": "18:30", "everyNWeeks": 1 },
  "idealMinutes": 45,
  "minimumMinutes": 10,
  "fallbackBehavior": "Sit down phone-free for the first 10 minutes",
  "outcomeId": null
}
```

`weekdays` is `0 = Sunday … 6 = Saturday` (JavaScript's `Date#getDay()`); a UI
that renders Monday-first changes only the display order. `time` is `HH:mm` in
`user_profiles.timezone`. `everyNWeeks` is `1`, `2` or `4` and is anchored to
the **Monday-start week the ritual was created in** — ISO week numbers wrap at
the year boundary, so they are not used. `minimumMinutes` may not exceed
`idealMinutes`, on create and on the merged result of a patch.

Passing `outcomeId` also creates a `Routine` under that outcome's active plan
version, so the ritual appears on the Path; its id comes back as `routineId`.
An outcome with no active plan version is a 409.

#### The materialization contract

- **Horizon**: `MATERIALIZE_HORIZON_DAYS = 7` local days, ending at the end of
  the seventh day. `lastMaterializedThrough` records how far the ritual is
  covered.
- **When**: synchronously on create, on demand through
  `POST …/materialize`, and nightly at 01:00 for every active ritual.
- **Idempotency**: the unique index `(ritual_id, scheduled_start)`. A repeat
  raises `P2002`, which is counted as `skipped` — never a duplicate row, and
  never an overwrite of an occurrence the user has already touched.
- **DST**: a wall time inside a spring-forward gap is shifted forward by the
  length of the gap; an ambiguous wall time in a fall-back overlap takes the
  first (still-DST) instant.
- **Each occurrence** is a `PLANNED` FAMILY commitment with `importance: 4`,
  `ritualId`, `familyMemberId`, the ideal duration as `fullMinutes`, the
  fallback text as `minimumVersion`, and a short version only when
  `idealMinutes − minimumMinutes ≥ 10`.
- **Editing** the title, recurrence, durations or fallback CANCELS the future
  `PLANNED` and `READY` occurrences **through the transition matrix** and
  materializes the new ones. Rows the user has started, moved, completed or
  skipped are never rewritten, and nothing is deleted. `active: false` cancels
  the future occurrences and stops the nightly run; `active: true` rebuilds
  them.
- **Deleting** a ritual cancels its future occurrences and sets `ritual_id` to
  null on the rest. A linked routine stays on the Path — it is what the plan
  used to say.

```json
POST /api/family/rituals/{id}/materialize
{ "data": { "created": 0, "skipped": 3, "through": "2026-09-12" } }
```

#### The behaviour lint

PRD §32: a family commitment describes the user's own behaviour. "Put phone
away during dinner" is a commitment; "Make spouse happier" is not, because the
system cannot control another person's behaviour and recording it would set the
user up to fail at something that was never theirs to do.

The check is **deterministic** and runs on `POST`/`PATCH /api/family/rituals`
and on `POST`/`PATCH /api/commitments` **when `domain` is `FAMILY`** — quick add
is held to the same rule. A WORK commitment with the same words is not linted.

```json
400 Bad Request
{
  "message": "Describe what you will do, not how someone else should feel or behave.",
  "details": {
    "reason": "BEHAVIOUR_TARGETS_OTHER_PERSON",
    "match": "Make Mia happier",
    "rule": "A"
  }
}
```

| Method | Path | Description |
|---|---|---|
| POST | `/api/family/lint` | Check a title and, optionally, get a rewrite (always 200) |

```json
POST /api/family/lint
{ "title": "Make Mia happier" }
```

```json
{
  "data": {
    "ok": false,
    "code": "TARGETS_OTHER_PERSON",
    "match": "Make Mia happier",
    "suggestion": "Read with Mia for 15 minutes",
    "source": "ai"
  }
}
```

Always 200 — this is a check, not a refusal. The **verdict never depends on
AI**: `suggestion` is `null` with `source: "none"` whenever the provider is
unavailable, the per-user window (10/min) is spent, or the model's own rewrite
fails the same lint. A suggestion is offered, never applied.

#### The review summary

| Method | Path | Description |
|---|---|---|
| GET | `/api/family/summary?weekStart=YYYY-MM-DD&weeks=1..12` | Planned versus kept, per ritual, per week |

`weekStart` is a Monday in the caller's timezone and defaults to the current
local week; `weeks` counts **backwards from it, inclusive** and defaults to 4.
Weeks come back newest first.

```json
{
  "data": {
    "timezone": "America/Costa_Rica",
    "weeks": [
      {
        "weekStart": "2026-09-01",
        "rituals": [
          {
            "ritualId": "8a1f…",
            "title": "Phone-free dinner",
            "planned": 3, "kept": 1, "partial": 0,
            "moved": 1, "skipped": 1, "missed": 0, "open": 0
          },
          {
            "ritualId": null,
            "title": "Other family commitments",
            "planned": 1, "kept": 1, "partial": 0,
            "moved": 0, "skipped": 0, "missed": 0, "open": 0
          }
        ],
        "totals": {
          "planned": 4, "kept": 2, "partial": 0,
          "moved": 1, "skipped": 1, "missed": 0, "open": 0
        }
      }
    ],
    "coachNote": {
      "text": "Work displaced 2 evening family commitments this week. Do you want to protect those times more aggressively, or is the current trade-off intentional?",
      "source": "template"
    }
  }
}
```

**What the counts mean.** `planned` is every row scheduled in the week in any
status except `CANCELLED`; `kept` is `COMPLETED`; `partial` is
`PARTIALLY_COMPLETED`; `moved` is `RESCHEDULED`; `skipped` is `SKIPPED`;
`missed` is `MISSED`; `open` is `PLANNED`, `READY` or `STARTED`. A ritual with
no rows this week is still listed at zero when it was active and already
existed — an every-other-week ritual must not look abandoned in its off week.
Ad-hoc family commitments (quick add, onboarding) are one line under
`ritualId: null`.

**Moved rows are counted where they were originally due.** A reschedule closes
the original as `RESCHEDULED` and opens a **new** `PLANNED` row at the new
time, so the original week counts the move and the new week sees the live row.
A commitment moved twice therefore leaves two `RESCHEDULED` rows behind, each
counted once in the week it was due.

**The payload is integers, deliberately.** PRD §35 permits
"Planned family commitments: 4 / Kept: 3" and nothing more; VISION §12 forbids
any relationship or parenting score outright, and PRD §105 makes
"Product never creates family-quality score" a hard acceptance rule. There is
no ratio, no percentage, no streak and no grade here, and adding one is not a
small change — a "kept %" sorts, can go down, and invites a colour scale, which
is exactly the gamified judgement PRD §35 rules out. A consumer that wants the
ratio can divide two integers; the API doing it for them is what would make it
the product's opinion rather than the reader's arithmetic.
`no-score.guard.spec.ts` fails the build if `score`, `quality`, `rating`,
`grade` or `sentiment` appears in any family schema, DTO, or `/api/family` path
of the OpenAPI document.

**`coachNote`** is PRD §35's sentence, and is `null` below two displaced
commitments — one displaced dinner in a week is a Tuesday, not a trend.
"Displaced" means a `SKIPPED` row whose reason is `UNEXPECTED_CONFLICT`,
`BAD_TIMING` or `TOO_MUCH`, plus a `RESCHEDULED` row carrying a reflection with
one of those friction tags. (A move with no stated reason is not evidence that
work displaced anything, and counting it would inflate the one number the
sentence rests on.) The numbers are computed by the server; AI may rephrase the
sentence but never compute it, and a rephrase that loses the count or rates the
relationship is discarded for the template. `source` says which you got.

#### Error codes

| Status | Code / reason | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod: a bad recurrence, a nickname over 40 characters, a key the member record may not hold |
| 400 | `details.reason = "BEHAVIOUR_TARGETS_OTHER_PERSON"` | The title describes another person's feelings or conduct |
| 400 | `details.reason = "MINIMUM_EXCEEDS_IDEAL"` | A patch whose merged result has a minimum longer than the ideal |
| 401 | `UNAUTHORIZED` | No bearer token, or an expired one |
| 400 | `details.reason = "WEEK_START_NOT_MONDAY"` | `weekStart` on the summary is not a Monday |
| 404 | `NOT_FOUND` | The id is unknown **or** belongs to another user — deliberately indistinguishable |
| 409 | `details.reason = "OUTCOME_HAS_NO_ACTIVE_PLAN"` | `outcomeId` names an outcome with no active plan version to hold a routine |


---

### Storage Objects

The storage system provides file upload and management capabilities with support for large files through resumable multipart uploads.

#### Upload limits (epic #67, issue #71)

Both upload paths enforce two configured limits that used to be declared and
read by nobody:

| Limit | Env var | Default | Enforced where |
|---|---|---|---|
| Allowed content types | `ALLOWED_MIME_TYPES` | `image/*,video/*` | `upload/init` from `mimeType`; simple upload from the multipart part's type, **before** a byte reaches the provider |
| Maximum size | `MAX_FILE_SIZE` | `524288000` (500 MiB) | `upload/init` from the declared `size`; simple upload from the bytes that actually flow |

A rejected upload answers **400** with a message naming what was wrong:

```
File type "text/plain" is not allowed. Allowed: image/*, video/*
File is 600000000 bytes; the limit is 524288000 bytes (500 MiB)
```

An oversize simple upload is aborted mid-stream, the partial object key is
deleted, and the response is the same 400. A successful simple upload now
records the real byte length in `size` — it used to persist `"0"` permanently.

#### Per-user quota (issue #87)

`STORAGE_USER_QUOTA_BYTES` (default 2 GiB, `0` disables) caps what one user may
hold across every object they own — **derived children included**. Sampled
video frames and normalized AI variants exist because the user uploaded
something and are stored under their id; excluding them would let a quota be
exceeded ninefold by uploading videos.

An in-flight upload counts against it. A quota that only sees finished uploads
is a quota you walk past by never calling `complete`. A `failed` object does
not: those bytes are the deployment's to clean up, not the user's to pay for.

`used + incoming === quota` is **allowed**. A limit you cannot reach is a
different limit.

##### GET /api/storage/quota

```json
{
  "data": {
    "usedBytes": "1048576",
    "quotaBytes": "2147483648",
    "remainingBytes": "2146435072"
  }
}
```

All three are strings — `size` is a `BigInt`. `quotaBytes` and `remainingBytes`
are `null` when quotas are disabled, so a client renders "unlimited" rather than
a meaningless progress bar. `remainingBytes` is clamped at `"0"` for a user who
is already over quota, which happens whenever an operator lowers the ceiling.

Both upload routes answer **413** past the quota, with a message naming used and
quota bytes. On the simple path the check runs twice: once up front with nothing
declared, and once with the counted bytes — at which point the object key is
deleted before the 413 is returned. That is the only honest ordering when the
length was never declared.

#### Image normalization (issue #87)

Every uploaded `image/*` object gets an EXIF-stripped, 1024 px JPEG sibling at
`derived/<id>/ai.jpg`, recorded at
`metadata._processing['image-normalize'].aiVariantObjectId`. The **original is
never modified** — the user uploaded it and can download it.

That variant is what the AI gateway sends. The original goes only when no
variant exists, and then only if it fits under `AI_MAX_IMAGE_BYTES`; otherwise
the attachment is a clear error rather than a request the provider refuses after
the bandwidth is spent. Sending the original would ship the user's GPS
coordinates to a third party (PRD §85, §86) and spend roughly fifty times the
tokens on an image the model reads at 1024 px anyway.

HEIC/HEIF is decoded first, because that is what an iPhone actually produces and
libvips as shipped cannot read it.

#### Attachment mode

`AI_ATTACHMENT_MODE=inline` (default) puts base64 in the request body the user's
own key pays for. `signed-url` hands the provider a short-lived GET
(`AI_ATTACHMENT_SIGNED_URL_TTL`, 300 s) that it fetches itself — a much smaller
request (PRD §118), at the cost of a credential that reaches this deployment's
storage. In that mode `S3_PUBLIC_ENDPOINT` must be a host the **provider** can
resolve; `http://minio:9000` cannot be, and the API logs a warning at boot
rather than refusing, because a public MinIO behind a TLS-terminating proxy is a
legitimate deployment this process cannot distinguish.

#### Access to another user's objects

Every storage route is plain `@Auth()`; **uploads are deliberately not gated on
`storage:write`**, because Viewer is the default EvolvePath role and every user
uploads media. Reads and writes are owner-scoped, with three admin overrides:

| Route | Override permission |
|---|---|
| `GET /storage/objects/:id`, `GET /storage/objects/:id/download` | `storage:read_any` |
| `PATCH /storage/objects/:id/metadata` | `storage:write_any` |
| `DELETE /storage/objects/:id` | `storage:delete_any` |

All three are seeded to **admin only**. A non-owner without the relevant
permission gets **403** — not 404. The storage API is generic and
permission-based, so "you may not" is the honest answer; media attachments
(`/api/media/attachments`) are a private product resource and answer 404
instead. That difference is deliberate.

An admin acting on somebody else's object writes `meta.actedAsAdmin: true` on
the audit row. `GET /storage/objects` (the listing) and the in-flight upload
routes stay owner-only.

#### Initialize Resumable Upload

`POST /api/storage/objects/upload/init`

**Requires Authentication** - Initialize a multipart upload for large files. Returns presigned URLs for direct-to-S3 uploads.

**Request Body:**
```json
{
  "name": "set-of-squats.mp4",
  "size": 104857600,
  "mimeType": "video/mp4"
}
```

**Errors:** `400` when the MIME type is not allowed or `size` exceeds
`MAX_FILE_SIZE`; `413` past the caller's storage quota. Nothing is created and
no multipart session is opened.

#### GET /api/storage/objects/:id/upload/urls

`?from=<n>&to=<m>` — more presigned PUT URLs, owner-only, at most **50 per
call**.

The init response above carries only the first ten. For anything over 100 MiB
at the default 10 MiB part size that is a dead end: the client has no way to get
URLs for parts 11 onward, so the resumable path — the only path that accepts a
phone video — could not complete.

```json
{ "data": { "presignedUrls": [{ "partNumber": 11, "url": "https://…" }] } }
```

`400` on an inverted range or a request for more than 50.

**Response:**
```json
{
  "data": {
    "objectId": "uuid",
    "uploadId": "s3-upload-id",
    "partSize": 10485760,
    "totalParts": 10,
    "presignedUrls": [
      { "partNumber": 1, "url": "https://..." },
      { "partNumber": 2, "url": "https://..." }
    ]
  }
}
```

---

#### Get Upload Status

`GET /api/storage/objects/:id/upload/status`

**Requires Authentication** - Check progress of an in-progress upload.

**Response:**
```json
{
  "data": {
    "status": "uploading",
    "uploadedParts": 5,
    "totalParts": 10,
    "progress": 50
  }
}
```

---

#### Complete Upload

`POST /api/storage/objects/:id/upload/complete`

**Requires Authentication** - Finalize multipart upload after all parts are uploaded.

**Request Body:**
```json
{
  "parts": [
    { "partNumber": 1, "eTag": "\"etag1\"" },
    { "partNumber": 2, "eTag": "\"etag2\"" }
  ]
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "processing"
  }
}
```

---

#### Abort Upload

`DELETE /api/storage/objects/:id/upload/abort`

**Requires Authentication** - Cancel an in-progress upload and clean up resources.

**Response:** HTTP 204 No Content

---

#### Simple Upload

`POST /api/storage/objects`

**Requires Authentication** - Direct upload for small files (< 100MB) using multipart/form-data.

**Request:**
- Content-Type: `multipart/form-data`
- Body: File attached as form data with key `file`

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "status": "uploading"
  }
}
```

---

#### List Objects

`GET /api/storage/objects`

**Requires Authentication** - List storage objects with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `status` | enum | - | Filter by status: `pending`, `uploading`, `processing`, `ready`, `failed` |
| `sortBy` | enum | `createdAt` | Sort field: `createdAt`, `name`, `size` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "document.pdf",
      "size": 104857600,
      "mimeType": "application/pdf",
      "status": "ready",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

---

#### Get Object

`GET /api/storage/objects/:id`

**Requires Authentication** - Get storage object metadata.

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "ready",
    "metadata": {
      "customField": "value"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### Get Download URL

`GET /api/storage/objects/:id/download`

**Requires Authentication** - Get a signed download URL for the object.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | number | 3600 | URL expiration in seconds |

**Response:**
```json
{
  "data": {
    "url": "https://s3.amazonaws.com/...",
    "expiresAt": "2024-01-01T01:00:00.000Z"
  }
}
```

---

#### Delete Object

`DELETE /api/storage/objects/:id`

**Requires Authentication** - Delete a storage object and its associated file.

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Object not found
- 403 Forbidden - User does not own object (non-admin)

---

#### Update Metadata

`PATCH /api/storage/objects/:id/metadata`

**Requires Authentication** - Update custom metadata for an object.

**Request Body:**
```json
{
  "metadata": {
    "customField": "value",
    "tags": ["document", "important"]
  }
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "metadata": {
      "customField": "value",
      "tags": ["document", "important"]
    },
    "updatedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### Media Attachments

> The full contract — the processing pipeline, the derived-object convention,
> the purposes and their rules, attachment modes and the rejected alternatives —
> is [`docs/specs/media-attachments.md`](specs/media-attachments.md).

**Requires Authentication.** The product-level view of an upload: what it is
*for*, what it belongs to, how far along the processing pipeline it is, and what
the coach said about it (epic #67, issue #83).

**Every route answers `404` for a foreign id — never `403`.** That is the
opposite of `/api/storage/objects`, deliberately. The storage API is generic and
permission-based, so "you may not" is an honest answer there and admins reach
other people's objects through `storage:*_any`. An attachment is a private
product resource, and an answer that distinguishes "not yours" from "does not
exist" tells a caller whether an id they do not own is real. Do not make one
match the other.

#### The attachment object

```json
{
  "id": "uuid",
  "storageObjectId": "uuid",
  "kind": "VIDEO",
  "purpose": "WORKOUT_FORM",
  "targetType": "workout_session",
  "targetId": "uuid",
  "processingStatus": "ready",
  "processingError": null,
  "media": {
    "mimeType": "video/mp4",
    "size": "2048",
    "width": 320,
    "height": 240,
    "durationMs": 2000,
    "frameCount": 4
  },
  "aiSummary": null,
  "createdAt": "2026-09-05T00:00:00.000Z",
  "updatedAt": "2026-09-05T00:00:00.000Z"
}
```

- `kind` is derived from the object's MIME type at creation — `image/*` →
  `PHOTO`, `video/*` → `VIDEO`. A client never sends it: it is a fact about the
  bytes, and a client that could claim otherwise would select the wrong
  coaching prompt.
- `purpose` is one of `WORKOUT_FORM`, `EQUIPMENT`, `MEAL`, `GENERAL`.
- `processingStatus` collapses the **five** storage statuses into the three a
  client can act on: `pending`/`uploading`/`processing` → `processing` (wait),
  `ready` (ask the coach), `failed` (retry). Showing "pending" and "uploading"
  as different things asks the user to care about a distinction that changes
  nothing they can do.
- `processingError` is the first `_processing.*_error` the pipeline recorded, so
  a client can say *why* without reading `_processing` JSON itself.
- `media.*` is read from `_processing['video-frames']` and
  `_processing['image-normalize']`; every field is null until processing
  finishes. `size` is a string — 64-bit values lose precision as JSON numbers.
- `aiSummary` is the validated `mediaAdviceSchema` output plus provenance, or
  `null` until somebody asks (`POST /:id/ask`).

#### POST /api/media/attachments

**Request Body:**
```json
{
  "storageObjectId": "uuid",
  "purpose": "WORKOUT_FORM",
  "targetType": "workout_session",
  "targetId": "uuid"
}
```

`targetType` and `targetId` are all-or-nothing: half a target is not a target,
because the index is on the pair and `targetId` alone is unqueryable. Legal
target types are `workout_session`, `commitment`, `outcome`, `coach_message` —
the value is checked here rather than by a foreign key, since the four live in
four tables and not all of them exist yet.

Attaching an object that is **still processing** is the normal case: the picker
attaches the moment the upload completes and then polls.

| Status | When |
|---|---|
| 201 | Created |
| 400 | Not an image or video, processing already failed, or a half-specified target |
| 404 | The storage object does not exist **or is not the caller's** |
| 409 | This upload is already attached — one attachment per upload, so re-purposing means uploading again |

#### GET /api/media/attachments

Query: `targetType`, `targetId`, `purpose`, `page` (1), `pageSize` (20, max
100). Returns the nested list shape (`{ items, meta }`), the caller's rows only,
newest first.

#### GET /api/media/attachments/:id

The attachment. `404` if it is absent **or not the caller's**.

#### DELETE /api/media/attachments/:id

`204`. Removes the attachment, its storage object, and every derived object —
the video's sampled frames, the normalized AI variant — by going through
`ObjectsService.delete` rather than growing a second deletion story.

#### POST /api/media/attachments/:id/ask

**Request Body:** `{ "question": "Is my back rounding on the way up?" }` —
optional, trimmed, max 500 characters.

**The coaching path is always `200`.** A provider failure, a missing key, or
output that fails the contract comes back as a readable result, not an
exception (PRD §120): the deterministic product keeps working when the model
does not, and a 5xx here would turn "the coach is unavailable" into "the page
is broken".

```json
{
  "data": {
    "ok": true,
    "advice": {
      "summary": "Your setup looks steady through the whole rep.",
      "observations": ["Your feet stay under the bar."],
      "advice": ["Brace hard before you unrack."],
      "safetyFlag": { "level": "none", "reason": "" }
    },
    "invocationId": "uuid",
    "model": "gpt-…",
    "latencyMs": 1240,
    "askedAt": "2026-09-06T00:00:00.000Z"
  }
}
```

```json
{ "data": { "ok": false, "error": { "code": "no_user_key", "message": "…" } } }
```

`no_user_key` is the one failure the UI must handle by **linking to
`/settings/ai-key`** rather than offering a retry: it is the user's to fix, and
retrying without a key produces the same answer.

`safetyFlag.level` is `none`, `caution` or `seek_professional`. A
`seek_professional` answer is rendered with **fixed copy** — not the model's
words — because the sentence a person reads when told to see a professional has
to be the same sentence every time, including on the day the provider is having
a bad one (PRD §45, §81). The model's `reason` is shown beside it, never
instead of it.

The advice is **persisted** on the attachment's `aiSummary`, together with
`askedAt`, the question, the invocation id, the prompt version and the model —
so reloading `/media` shows the same answer, and "which prompt said this?" is
answerable without a join. A failure stores nothing: it must not overwrite a
good previous answer.

The **purpose selects the instructions**. `MEAL` forbids calories, macros,
grams and any judgment of the user's body; `WORKOUT_FORM` forbids diagnosis and
withholds cues on the `seek_professional` path; `EQUIPMENT` keeps claims to
what is visible.

| Status | When |
|---|---|
| 200 | The coach answered, **or** could not — read `ok` |
| 400 | The media failed processing, or the question is over 500 characters |
| 404 | Not found, or not the caller's |
| 409 | The media is still processing — poll, do not change the request |
| 429 | More than ten asks a minute |

#### GET /api/media/attachments/:id/preview

Query: `variant` (`original` | `ai` | `frame`, default `original`),
`frameIndex` (default 0).

```json
{ "data": { "url": "https://…", "expiresIn": 3600, "variant": "frame" } }
```

`variant` in the **response** says what was actually served: asking for `ai`
when no normalized variant exists returns the original and says so, because a
caller asking for a preview wants a picture. `400` when the media is not `ready`
or the requested frame does not exist.

---

### Health

**Public endpoints** - Used for Kubernetes liveness/readiness probes.

#### GET /health
Full health check - includes database connectivity test. Equivalent to GET /health/ready.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

**Error Cases:**
- 503 Service Unavailable - Database connection failed

---

#### GET /health/live
Liveness check - always returns 200 if service is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

#### GET /health/ready
Readiness check - includes database connectivity test.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

**Error Cases:**
- 503 Service Unavailable - Database connection failed

---

### Coach

The AI coach (PRD §14.3, §66). Every reply is a validated structured object,
never free prose (PRD §16).

**`POST /api/coach/messages` is always a 201.** A provider timeout, a rate
limit, a missing key, a schema violation, or a reply naming things the user
does not have all produce a readable coach message plus `degraded: true` — PRD
§120's promise is "the screen still works", not "the API fails quickly".

A conversation that is not yours answers **404, never 403**.

#### Send a message

```http
POST /api/coach/messages
Content-Type: application/json
Authorization: Bearer <token>

{
  "conversationId": "0a44…",
  "text": "My schedule changed. I can't work out Wednesday anymore.",
  "attachmentIds": []
}
```

`conversationId` is optional — omitting it starts a thread titled from the
first 60 characters of `text`.

```json
{
  "conversationId": "0a44…",
  "userMessage": { "id": "…", "role": "USER", "content": "My schedule changed…", "structured": null, "safety": null, "attachmentIds": [], "createdAt": "…" },
  "coachMessage": {
    "id": "…",
    "role": "COACH",
    "content": "Wednesday evenings keep slipping. Want to move it to Saturday morning?",
    "structured": {
      "intervention_type": "PLAN_CHALLENGE",
      "reasoning_summary": "Wednesday has been missed three weeks running.",
      "user_message": "Wednesday evenings keep slipping…",
      "recommended_action": null,
      "fallback_action": null,
      "proposal": { "kind": "plan_change", "planId": "…", "summary": "…", "changes": [ … ], "proposalId": "6f0d…" },
      "friction_question": null
    },
    "safety": { "decision": "allow", "category": "none" },
    "attachmentIds": [],
    "createdAt": "…"
  },
  "proposal": { "id": "6f0d…", "status": "PROPOSED", … },
  "degraded": false
}
```

Notes on the shape:

- `structured` is **null** on a degraded turn. A template fallback is
  deliberately indistinguishable from "no model output", because that is what
  it is — a client that could tell them apart would start rendering a fake
  intervention type.
- `reasoning_summary` is what "Why this?" shows. It is a summary, never chain of
  thought (PRD §16, §88).
- A `proposal` creates exactly one `PlanChangeProposal` and **zero**
  `PlanVersion` rows. Accepting it is a separate call — see **Plan Proposals**.
- `safety` carries only `decision`, `category` and `userFacingNote`. The matched
  rule id and prompt version are audit fields and stay server-side.
- `invocationId` is never on the wire.

**Error Cases:**
- 400 Bad Request - `attachment_not_found` (not yours, or not `ready`), or an invalid body
- 404 Not Found - no such conversation of yours

#### Conversations

```http
POST   /api/coach/conversations            { "title": "Schedule change" }  → 201
GET    /api/coach/conversations?limit=20&cursor=<id>                        → 200
GET    /api/coach/conversations/{id}/messages?limit=50&before=<messageId>   → 200
DELETE /api/coach/conversations/{id}                                        → 204
```

The list is ordered by `lastMessageAt` descending. Messages come back ascending
by time and paginate upward with `before`.

Deleting a conversation removes its messages (PRD §84). A proposal created from
one of them survives with `sourceMessageId: null` — the record of a plan change
the user was offered is not part of the conversation.

#### Suggested prompts

```http
GET /api/coach/suggested-prompts
```

The seven PRD §66 chips, in order. **The order is the spec**: they run from
planning through friction to re-deciding.

---

### Memory Insights

What the coach remembers about the user, and the controls PRD §85 gives them
over it. An id that is not yours answers **404, never 403**.

**Two booleans, two questions, and neither is the other's negation.**
`userConfirmed` is "the user says this is true"; `doNotUse` is "never bring
this up". An insight can be both true and forbidden.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/memory-insights?category=&includeDoNotUse=true` | Ordered by category, confirmed first, then confidence. Excluded insights are hidden unless asked for |
| `POST` | `/api/memory-insights` | `{category, statement}` — stored `USER`, confirmed, confidence 1 |
| `PATCH` | `/api/memory-insights/{id}` | `{statement}` — editing an AI guess **confirms** it |
| `POST` | `/api/memory-insights/{id}/confirm` | The coach uses confirmed insights and no others |
| `POST` | `/api/memory-insights/{id}/do-not-use` | `{doNotUse}` — leaves every prompt, stays visible here |
| `DELETE` | `/api/memory-insights/{id}` | 204. A **hard delete**; the audit row records the category only |
| `POST` | `/api/memory-insights/propose` | Ask the coach what it has noticed |

#### Propose

```http
POST /api/memory-insights/propose
Authorization: Bearer <token>
```

```json
{
  "created": [
    {
      "id": "…",
      "category": "PATTERN",
      "statement": "Morning commitments are more reliable than evening ones.",
      "evidenceCount": 15,
      "confidence": 0.8,
      "userConfirmed": false,
      "doNotUse": false,
      "expiresAt": "2026-12-04T…",
      "source": "AI"
    }
  ],
  "skipped": null
}
```

Reads 28 days of **aggregated counts** — no titles, no reflection text, no
names — and proposes at most five insights, each `userConfirmed: false` and
expiring in 90 days. PRD §10.12: a durable inference needs explicit approval
before it becomes a planning assumption, so the coach cannot see one until it
is confirmed.

**Always a 200.** Fewer than 10 decided commitments gives
`skipped: "insufficient_data"` with no model call; a provider outage gives
`skipped: "ai_unavailable"`. Neither is a broken screen.

Something the user marked `doNotUse` is **never re-proposed** — "don't use
this" is an answer, and re-asking would be the product ignoring it. (A
*forgotten* insight is genuinely gone and may legitimately come back.)

**Error Cases:**
- 429 Too Many Requests - one run per ten minutes per user, with `retryAfterSeconds`

---

### Plan Proposals

A proposed change to a plan, waiting on a human (PRD §15). **Accepting one is
the only path in the product that turns AI output into a `PlanVersion`** — the
coach, the weekly review and workout adaptation all create proposals and none
of them writes a plan.

There is deliberately **no `POST /proposals`**: a route that accepted a change
set from a browser would let a client author a plan version and label it `AI`.

A proposal that is not yours answers **404, never 403** — the repo-wide rule in
`apps/api/src/path/owned-resource.ts`.

#### List proposals

```http
GET /api/proposals?status=PROPOSED&planId=<uuid>
Authorization: Bearer <token>
```

Newest first. Both query parameters are optional.

#### Read one, with the diff accepting it would produce

```http
GET /api/proposals/{id}
Authorization: Bearer <token>
```

```json
{
  "id": "6f0d…",
  "planId": "0a44…",
  "sourceKind": "COACH",
  "status": "PROPOSED",
  "summary": "Move the Wednesday workout to Saturday morning.",
  "changeCount": 1,
  "edited": false,
  "expiresAt": "2026-09-12T16:00:00.000Z",
  "changes": [
    {
      "op": "move",
      "target": { "type": "routine", "id": "1111…" },
      "before": null,
      "after": { "preferredTime": "09:00", "triggerValue": "SAT", "daysOfWeek": [6] },
      "reason": "Wednesday evenings stopped working"
    }
  ],
  "originalChanges": null,
  "preview": {
    "diff": [
      {
        "op": "move",
        "target": { "type": "routine", "id": "1111…", "title": "Strength workout" },
        "reason": "Wednesday evenings stopped working",
        "fields": [
          { "field": "triggerValue", "before": "WED", "after": "SAT" },
          { "field": "daysOfWeek", "before": [3], "after": [6] },
          { "field": "preferredTime", "before": "18:30", "after": "09:00" }
        ]
      }
    ],
    "errors": []
  },
  "activeVersion": { "id": "9c1e…", "version": 1 }
}
```

`preview.diff` is produced by the same pure function `accept` applies, so what
the user reads and what happens cannot drift apart. A non-empty
`preview.errors` means `accept` would answer 422.

Reading a proposal past its 7-day life marks it `EXPIRED`. Expiry is **lazy**:
there is no sweeper rewriting user data on a schedule.

#### Accept

```http
POST /api/proposals/{id}/accept
Authorization: Bearer <token>
```

```json
{
  "proposal": { "status": "ACCEPTED", "appliedPlanVersionId": "77aa…" },
  "planVersion": { "id": "77aa…", "version": 2, "status": "ACTIVE" }
}
```

Atomic. The new version, its routines, the effects on future commitments and
the proposal's own status all commit together or not at all. The previous
version becomes `SUPERSEDED` and **keeps its routines**, so the history stays
readable (PRD §103).

Future `PLANNED` commitments of a moved routine are rescheduled;
`rescheduleCount` is **not** incremented — that column counts how often the
*user* pushed something. Commitments of a removed or paused routine are
`CANCELLED` with `skipReason: "plan_change"`. Past commitments and evidence are
never touched.

**Error Cases:**
- 409 Conflict - `proposal_not_actionable` (already decided) or `proposal_expired`
- 422 Unprocessable Entity - `invalid_changes`, with a per-index error list
- 404 Not Found - no such proposal of yours

#### Edit

```http
POST /api/proposals/{id}/edit
Content-Type: application/json
Authorization: Bearer <token>

{ "changes": [ … ] }
```

The **whole** change set, not a patch: the user is deciding what they are
agreeing to. What the coach originally proposed is kept in `originalChanges`
from the first edit onward, and an accept after an edit is attributed
`createdBy: "USER"` — attribution follows who wrote the content.

#### Reject

```http
POST /api/proposals/{id}/reject
Content-Type: application/json
Authorization: Bearer <token>

{ "reason": "Wednesday is fine, it was one bad week" }
```

Touches no plan and no version. The reason (≤300 chars, optional) is kept for
the coach to read back.

---

### Weekly Review

The PRD §135 weekly loop's first half: what was planned against what actually
happened, for one Monday-start week, plus the coach's reading of it.

**Two things are stored, and they are deliberately separate.** `aggregates` is
computed by a pure function with no model in it. `aiSummary` is the coach's
six-part reading of those numbers — and when the provider is unreachable, or the
user has brought no key, it becomes the numbers read back with
`source: "template"` and an empty `proposedChanges`. A review is therefore
**always** produced (PRD §120): a weekly ritual that only happens when an API is
up is not a ritual.

**Generation never writes a plan version.** Any change the reviewer proposes
becomes a `plan_change_proposals` row with `sourceKind: "WEEKLY_REVIEW"` and
stops there; the plan changes only when the user calls
`POST /proposals/{id}/accept` (PRD §15, §89). A proposal naming a plan or
routine the user does not have is dropped before it is written and counted in
the audit row's `droppedProposals`.

Weeks are addressed by their **local Monday** as a `'YYYY-MM-DD'` string.

#### Generate a review

```http
POST /api/weekly/reviews/generate
Content-Type: application/json
Authorization: Bearer <token>

{ "weekStart": "2026-08-31" }
```

`weekStart` is optional. Omitting it reviews **last week on Monday and Tuesday**
and **the week in progress from Wednesday onward** — a Monday-morning review of
"this week" would be a review of nothing.

```json
{
  "id": "b71c…",
  "weekStart": "2026-08-31",
  "status": "READY",
  "counts": {
    "WORK": { "planned": 5, "completed": 4 },
    "FAMILY": { "planned": 3, "completed": 2 },
    "HEALTH": { "planned": 3, "completed": 2 }
  },
  "aggregates": {
    "coverage": { "from": "…", "to": "…", "partial": false },
    "domains": { "WORK": { "planned": 5, "completed": 4, "skipped": 1, "…": 0 } },
    "timeWindows": [{ "window": "morning", "planned": 5, "completed": 4, "successRate": 0.8 }],
    "rescheduleLeaders": [{ "title": "Strength workout", "rescheduleCount": 2 }]
  },
  "aiSummary": {
    "whatWorked": ["Morning focus blocks: 4 of 5 done"],
    "whatDidNot": ["Evening workouts were moved twice"],
    "patterns": [{
      "observation": "4 of 5 morning commitments were done; 1 of 3 in the evening",
      "inference": "Plans after 18:00 are less reliable than mornings",
      "recommendation": "Move the Wednesday workout to Saturday morning",
      "confidence": 0.8,
      "domain": "HEALTH"
    }],
    "proposedChanges": [{ "planId": "0a44…", "summary": "Move Wednesday workout to Saturday" }],
    "keepUnchanged": ["Morning focus block routine"],
    "doNotAddYet": [],
    "source": "ai",
    "promptVersion": "weekly_reviewer.v1",
    "generatedAt": "2026-09-06T22:00:00.000Z"
  },
  "proposals": [ /* resolved ProposalDetail rows — see Plan Proposals */ ],
  "plan": null
}
```

A **pattern is three separate claims** (PRD §14.4) and the screen labels each:
`observation` is what the numbers say, `inference` is a guess, `recommendation`
is what to do. `inference` and `recommendation` are null on a template summary,
because a template is not allowed to guess.

`invocationId` is deliberately **not** on the wire. It is an internal telemetry
pointer, written to the review row and the audit meta and nowhere a client can
read it.

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_WEEK_START` | Not a Monday, or not `YYYY-MM-DD` |
| 409 | `WEEKLY_REVIEW_APPROVED` | The week was closed by an approved plan |
| 409 | `WEEKLY_REVIEW_IN_PROGRESS` | A generation started less than 15 minutes ago |
| 429 | `RATE_LIMITED` | Five generations per hour per user |

#### List, read and skip

```http
GET  /api/weekly/reviews?weekStart=2026-08-31&limit=12
GET  /api/weekly/reviews/current
GET  /api/weekly/reviews/{id}
POST /api/weekly/reviews/{id}/skip
```

`current` answers **`null`, not 404**, for a user who has never had a review —
an empty screen is a state, not an error. Another user's review id answers
**404, never 403**. Skipping a review that is not `READY` answers 409
`WEEKLY_REVIEW_NOT_SKIPPABLE`.

#### Weekly rhythm

```http
GET /api/weekly/settings
PUT /api/weekly/settings
Content-Type: application/json

{ "weeklyReviewWeekday": 5, "weeklyReviewTime": "16:00" }
```

```json
{
  "weeklyReviewWeekday": 5,
  "weeklyReviewTime": "16:00",
  "timezone": "America/Costa_Rica",
  "nextReviewAt": "2026-09-11T22:00:00.000Z"
}
```

Weekday is 0 (Sunday) to 6 (Saturday); a value outside that range is rejected by
Zod **and** by a database check constraint. **The sweep runs hourly**, so a
review set for `16:30` is prepared in the 16:00 pass — the minutes are stored
faithfully but are not a promise.

"Your week is ready to review" (PRD §60's N8) is raised by the coaching
notification engine reading `weekly_reviews`, not by generation itself, so it
passes through quiet hours and the caps like every other coaching message. See
[Coaching Notification Policy](#coaching-notification-policy-current-user).

---

### Weekly Planning

The PRD §135 loop's second half, and PRD §50's seven steps: review last week →
fixed constraints → one primary focus → domain modes → propose commitments →
check the load → approve. The draft row is what makes it a flow rather than a
form: each step is a `PATCH`, so closing the tab on step three loses nothing.

**No model is called anywhere in this section.** Materialisation is arithmetic
over the user's own routines; asking a model to produce next week's dates would
make a deterministic thing occasionally wrong and never reproducible.

#### Start (or resume) next week

```http
POST /api/weekly/plans
Content-Type: application/json
Authorization: Bearer <token>

{ "weekStart": "2026-09-07" }
```

`weekStart` defaults to next Monday in the user's own timezone. **Idempotent**:
a second call returns the existing `DRAFT` rather than a second one — the wizard
calls this on mount, and a refresh must not fork the week. **201** for a new
draft, **200** when an existing one comes back.

`domainModes` opens on the postures the user is in **today**, so a user who
changes nothing keeps what they had.

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_WEEK_START` | Not a Monday, or a week that has already ended |
| 409 | `WEEKLY_PLAN_APPROVED` | That week is already approved |

#### Save one step

```http
PATCH /api/weekly/plans/{id}
Content-Type: application/json

{
  "constraints": {
    "travelDays": ["2026-09-09"],
    "fixedEvents": [
      { "date": "2026-09-11", "title": "Dentist", "startTime": "10:00", "endTime": "11:00" }
    ],
    "notes": null
  },
  "primaryFocus": "Ship the proposal draft",
  "domainModes": { "FAMILY": "MAINTAIN" }
}
```

`constraints` is **replaced whole** — removing a travel day has to be
expressible, and a merge patch cannot delete an array element. `domainModes` is
**merged** — naming `FAMILY` means "leave the other two alone", which is
different from asserting `GROW` for domains the user never looked at.

Any of these **clears the previous proposal**, which now describes a week nobody
asked for. `DRAFT` only; otherwise 409 `WEEKLY_PLAN_NOT_EDITABLE`.

#### Propose the week

```http
POST /api/weekly/plans/{id}/propose
Content-Type: application/json

{ "extras": [
  { "domain": "WORK", "title": "Reading block", "date": "2026-09-08",
    "startTime": "20:00", "estimatedMinutes": 20, "recurring": true }
] }
```

Every active routine — on an `ACTIVE` plan version under an `ACTIVE` outcome —
is expanded across the week, the constraints and paused domains are applied, the
user's extras are appended, and the load check runs.

```json
{
  "proposal": {
    "items": [
      {
        "key": "9c3a…:2026-09-09",
        "source": "routine",
        "include": false,
        "excludedBy": "travel_day",
        "domain": "WORK",
        "title": "Morning focus block",
        "date": "2026-09-09",
        "startTime": "07:30",
        "estimatedMinutes": 50,
        "recurring": true
      }
    ],
    "summary": {
      "recurringCount": 2,
      "estimatedMinutes": 320,
      "byDomain": { "WORK": { "count": 4, "minutes": 200 } },
      "softCap": 8,
      "capacityMinutes": 1200
    },
    "warnings": [],
    "proposedAt": "2026-09-06T20:00:00.000Z"
  }
}
```

**An excluded occurrence is still an item.** PRD §50 step 5 shows the user what
their week *would* be, so a Wednesday dropped for a travel day comes back with
`include: false` and an `excludedBy` reason rather than omitted — a silently
missing row is indistinguishable from one the product forgot about.

`excludedBy` is `travel_day`, `fixed_event` (a timed event that overlaps the
occurrence, or an event with **no** times, which blocks the whole day) or
`paused_domain`. An occurrence that **already exists** on the calendar is not
returned at all: it is not a proposal any more.

**Recurring counts are per routine, not per occurrence.** Five morning focus
blocks are one habit; counting occurrences would put every weekday routine over
an eight-commitment cap on its own.

Warnings are **data, never exceptions** (PRD §48 recommends, it does not
refuse):

| Code | Raised when |
|---|---|
| `RECURRING_OVER_CAP` | `recurringCount > WEEKLY_LOAD_SOFT_CAP` (default 8) |
| `MINUTES_OVER_CAPACITY` | Total minutes exceed `5 × weekdayMinutes` |
| `DAY_OVER_CAPACITY` | The single heaviest day exceeds `weekdayMinutes` |

A null `weekdayMinutes` — the user never told us — produces no capacity warning
at all rather than one about a fabricated budget.

#### Approve next week

```http
POST /api/weekly/plans/{id}/approve
Content-Type: application/json

{ "acknowledgeWarnings": true }
```

One transaction: a `PLANNED` commitment per included item (through the ordinary
commitment service, so ownership checks, the family behaviour lint and the
`commitment:create` audit row all apply), the domain modes that **actually
changed** (through `DomainModesService`, so `domain_mode:set` is written with
its reason), and the previous week's review marked `APPROVED`.

```json
{
  "plan": { "id": "…", "status": "APPROVED", "approvedAt": "…" },
  "createdCommitmentIds": ["…"],
  "skippedExisting": 0,
  "warnings": []
}
```

**Idempotent under retry**: an occurrence already on the calendar is skipped and
counted in `skippedExisting`, so a half-completed approve is finished rather
than duplicated.

`userConfirmed` is `true` on every created commitment, and **only** because the
user pressed approve.

| Status | Code | Meaning |
|---|---|---|
| 409 | `WEEKLY_PLAN_NOT_EDITABLE` | Already approved |
| 409 | `WEEKLY_PLAN_NOT_PROPOSED` | Nothing has been proposed to approve |
| 422 | `LOAD_WARNINGS_UNACKNOWLEDGED` | Warnings outstanding; they are in `details.warnings` |

The 422 is deliberate rather than a 409: the request is well-formed and the
state is legal. What is missing is that the user has *read* the warning — which
is all acknowledgement means. The software has not agreed with them.

#### List and read

```http
GET /api/weekly/plans?weekStart=2026-09-07
GET /api/weekly/plans/{id}
```

Another user's plan id answers **404, never 403**.

### Workouts

The full written contract for this domain — the rules, the progression table,
the detectors and what each of them refuses to do — is
[`docs/specs/health-domain.md`](specs/health-domain.md). This section is the
wire shapes.

Structured training (PRD §37–§44). The program lives in tables rather than in a
chat transcript, which is what lets it schedule itself onto Today, show "last
time" on the next session, and be adapted when it keeps failing.

**Nothing here writes a plan until the user approves.** `generate` writes
`workout_programs` rows and stops; `plans`, `plan_versions`, `routines` and
`commitments` are untouched until `POST /workouts/programs/{id}/approve`
(PRD §15).

#### The exercise catalog

```http
GET /api/workouts/exercises?q=row&group=horizontal_pull
Authorization: Bearer <token>
```

The 44 seeded movements plus the caller's own custom rows — never another
user's. `substitutionGroup` is what makes "what can I do instead of a lat
pulldown?" a lookup rather than a model call, so it keeps working with the
provider down.

#### Draft a program

```http
POST /api/workouts/programs/generate
Content-Type: application/json
Authorization: Bearer <token>

{
  "goal": "Get stronger and look better",
  "experience": "BEGINNER",
  "daysPerWeek": 3,
  "minutesPerSession": 40,
  "equipment": ["DUMBBELL", "BENCH"],
  "limitations": "left shoulder is not great overhead"
}
```

```json
{
  "data": {
    "program": { "id": "…", "name": "…", "status": "DRAFT", "templates": [ … ] },
    "source": "ai",
    "reason": null,
    "message": null
  }
}
```

Three things happen in order, and the order is the point:

1. **Safety runs before the model.** A `redirect` decision means the programmer
   persona is never invoked and the response carries professional-care copy —
   which is exactly the situation a model-written answer would not arrive in.
2. **The model is asked**, with a catalog filtered to the equipment the user
   actually has.
3. **The answer is checked** against deterministic rules: a beginner gets at
   most four days, the week matches what was asked for, no movement is
   prescribed that clashes with a stated limitation, and a FULL session has to
   fit the requested minutes within 10%.

Any failure — a rejected proposal, an unreachable provider, a safety redirect —
returns **the deterministic starter program** with a `reason`
(`invalid_output`, `ai_unavailable`, `safety_redirect`, `requested`) and one
sentence for the user in `message`. It is a worse program and a working product
(PRD §120). `useStarter: true` skips the model entirely.

The one exception is **412 `AI_KEY_REQUIRED`**: no key is a thing the user can
go and fix, and handing them a starter program would hide it.

#### Approve

```http
POST /api/workouts/programs/{id}/approve
Content-Type: application/json
Authorization: Bearer <token>

{ "preferredTime": "07:00", "startDate": "2026-09-07" }
```

One transaction, five parts: the Health outcome and its plan exist; a new
`PlanVersion` carries the program's rationale with `userApproved: true`; one
`Routine` per FULL template, linked back by `workout_templates.routine_id`; any
previously active program is archived and its future days cancelled; and the
next **14 days** of training-day commitments are written, each carrying its
full, short and minimum sizes.

`preferredTime` defaults to `07:00` and `startDate` to tomorrow in the user's
own timezone. **409 `PROGRAM_NOT_DRAFT`** for a program that has already been
decided on.

#### Run a workout

```http
POST /api/workouts/sessions
Content-Type: application/json
Authorization: Bearer <token>

{ "commitmentId": "…", "variant": "FULL" }
```

Exactly one of `commitmentId` (today's scheduled workout) or `templateId` (an
ad-hoc session). A commitment-backed start goes through the ordinary
`POST /commitments/{id}/actions/start`, so the timer, the transition matrix and
the `started` evidence stay in one place rather than being reimplemented here.

One workout is open at a time: a second start answers **409
`SESSION_IN_PROGRESS`** with the open session's id in `details.sessionId`.

The response is the runner view: the exercise list for the current variant,
every set logged so far, `header` (`"Upper A · Workout 3 of 18"`), the variants
available to drop to, and per movement a `lastTime` — the sets of the most
recent **COMPLETED** session for it, **in any template**. Any template
deliberately: a user's bench press history is their bench press history, and
scoping it to one workout would reset it whenever the program changed.

#### Log sets

```http
POST /api/workouts/sessions/{id}/sets
Content-Type: application/json

{
  "clientId": "11111111-1111-4111-8111-111111111111",
  "exerciseId": "…",
  "setNumber": 1,
  "weightKg": 20,
  "reps": 12,
  "rpe": 7,
  "discomfort": "NONE"
}
```

`clientId` is minted by the **client**, and it is the whole of PRD §121's
offline story: the phone queues sets it could not send and replays the queue on
reconnect, so the server has to tell a replay from a second set. The same
`clientId` twice returns the row that already exists; the same
`(exercise, setNumber)` under a **new** `clientId` is a correction and
overwrites.

`POST /api/workouts/sessions/{id}/sets/batch` is the replay entry point. It is
**never all-or-nothing** — the response splits into `accepted`, `duplicates` and
`rejected`, because one bad set must not cost the user the twenty-nine good ones
they actually performed.

`discomfort: "SHARP_PAIN"` flags the session and returns the PRD §45 copy with
`action: "stop_exercise"`. **No model is called**, and the copy contains no
programming advice — this is the one signal the software does not reason about.

#### Switch to a smaller version

```http
POST /api/workouts/sessions/{id}/switch-variant
{ "variant": "SHORT" }
```

Re-derives the exercise list from the sibling template. Sets already logged for
movements the new variant does not include are kept and returned under
`alsoLogged`: they really happened, and dropping them would make the app appear
to lose work the user watched it save. **400 `VARIANT_NOT_DEFINED`** when the
sibling does not exist.

#### Why this weight?

```http
GET /api/workouts/sessions/{id}/exercises/{exerciseId}/explain
Authorization: Bearer <token>
```

```json
{ "data": { "sentence": "Two sessions at the top of the range and comfortable — a small increase to 22.5 kg.", "source": "template" } }
```

PRD §42: **the rule decides, the coach explains.** `exercises[].progression` on
the session view is produced by a pure function over the last two COMPLETED
sessions for that movement — two, not one, because one good day is a good day
and two is a trend:

| Situation | Action | Reason |
|---|---|---|
| No history | `hold` | `first_session` |
| Sharp pain in the last session | `hold` | `discomfort` |
| Both of the last two sessions: every prescribed set at `repMax`, RPE ≤ 8 or absent | `increase` | `top_of_range_twice` |
| Both of the last two sessions: any set below `repMin` | `reduce` (95%) | `below_min_twice` |
| Only one session so far | `hold` | `insufficient_history` |
| Anything else | `hold` | `building` |

Increments are equipment facts, not tuning parameters: dumbbell 2.5 kg, barbell
5 kg, machine 5 kg, kettlebell 4 kg, cable 2.5 kg. Bodyweight and band work
still reports `increase` with a null weight — the client says "add a rep or make
it harder" — because reporting `hold` would tell somebody who is plainly
progressing that they are not. Every weight is rounded to 0.25 kg.

This endpoint adds a sentence and nothing else. **Any number in the model's
reply that the suggestion does not contain discards the sentence** in favour of
the template — a fluent "go to 25 kg" is indistinguishable from a true one to a
reader and puts weight on a bar. `source` is `template` whenever the provider is
down, the user has no key, or the guard fired, and the answer is cached per
`(session, exercise)` so tapping the chip twice does not spend the key twice.

#### Finish

```http
POST /api/workouts/sessions/{id}/finish
{ "status": "COMPLETED", "notes": "felt strong" }
```

Writes one `WORKOUT_LOG` evidence row (volume in kilograms, with the set count,
minutes, variant and notes in `qualitativeValue`) and settles the attached
commitment through the ordinary actions:

| Session | Attached commitment becomes |
|---|---|
| `COMPLETED`, variant `FULL`, every movement logged | `COMPLETED` |
| `COMPLETED` otherwise | `PARTIALLY_COMPLETED` |
| `ABANDONED` with at least one set | `PARTIALLY_COMPLETED` |
| `ABANDONED` with nothing logged | unchanged — still `STARTED` |

The last row is deliberate: the user opened the app, changed their mind, and
still has all of Today's vocabulary available. Marking it partial would be the
product deciding they failed at something they never started.

#### Media coaching

```http
POST /api/workouts/sessions/{id}/form-check   { "storageObjectId": "…", "exerciseId": "…", "setNumber": 1 }
POST /api/workouts/equipment-check            { "storageObjectId": "…" }
POST /api/nutrition/meal-check                { "storageObjectId": "…" }
```

Three typed calls on the `media_analyst` persona, each carrying context the
user should not have to type — which exercise, which set, what weight, which
program. **All three always answer 200**: a provider failure is
`{ ok: false, error }` (PRD §120), because the form check is a screen somebody
is standing in front of and an exception there ends the workout.

`storageObjectId` is an object uploaded through `POST /api/storage/objects`;
ownership is the storage service's own check, and **409 `MEDIA_NOT_READY`**
until the upload lands. Ten checks a minute per user — each call sends images,
and a video arrives as several frames.

**The form check withholds its cues whenever a body is the question.** A
`pain_reported` or `joint_instability` flag, a session already carrying
`discomfortFlag`, or a set the user logged with any discomfort, all produce
`cues: []`, the PRD §45 copy in `safetyNote`, and `redirected: true`. Cues
alongside "get this looked at" would read as permission to keep going. The
contract has no score, grade or rep count for the same reason — a field the
model cannot fill is a field it cannot invent.

**The equipment check proposes rather than edits.** Detected equipment goes
through a deterministic pass over the active program: movements the room cannot
do, and what the catalog's `substitutionGroup` offers instead. Those become a
`WORKOUT` plan-change proposal (PRD §15); the check itself changes nothing.

**The meal check never counts.** Any output mentioning calories, macros, grams
or portion weights is rejected **whole** — `{ ok: false, code: 'schema' }` — and
nothing is stored. Not edited: a stripped sentence reads as an omission, and we
would be publishing the rest of a reply that had already ignored its
instructions (PRD §46, VISION §16).

Answers are stored on the storage object's `metadata._coaching`, alongside the
`_processing` key the video sampler uses. That is a deliberate seam:
`media_attachments.ai_summary` (epic #67) is where they belong, and moving them
is one method on `MediaSummaryService`.

#### Adaptation

```http
POST /api/workouts/adaptation/run
GET  /api/workouts/adaptation/candidates
POST /api/workouts/templates/{templateId}/exercises/{id}/dislike
```

PRD §43's signals, detected deterministically over the last **14 days**:

| Detector | Trigger | Proposes |
|---|---|---|
| `SKIPPED_TWICE` | ≥ 2 `SKIPPED`/`MISSED` days for one workout | `reduce` to 65% of the target, to the nearest 5, floored at 15 min |
| `TOO_LONG` | ≥ 2 completed sessions running > target + 15 min | the same `reduce`, quoting the measured average |
| `DISLIKED` | the user marked a movement "not this one" | `replace` with the first alternative |
| `EXERCISE_SKIPPED` | a movement absent from the last 3 completed sessions | `replace` with the first alternative |

"Has this been skipped twice in a fortnight?" is counting, and it is counted
rather than asked of a model: the answer decides whether somebody is shown a
proposal about their own failure, which is the one place in this product where a
false positive is actively unkind.

**At most one proposal per workout per fortnight**, and **nothing is changed**.
The detector writes a `plan_change_proposals` row with `sourceKind: WORKOUT` and
stops; the template changes when — and only when — the user calls
`POST /proposals/{id}/accept` (PRD §15). `GET /proposals?sourceKind=WORKOUT`
filters to them.

Accepting runs the Health domain's own effect **inside E06's accept
transaction**: the template's `targetMinutes`, the minutes on future `PLANNED`
days, the swapped exercise on the full **and** short versions, and the
re-pointing of `workout_templates.routine_id` at the routine on the version that
was just activated. Without that last step the 1:1 link would still point at a
routine on a superseded version, and the next run would target a routine nothing
schedules.

The daily sweep runs at 04:00 and can be stopped with
`WORKOUT_ADAPTATION_CRON_DISABLED=true`. A failure for one user is logged and
the loop continues.

#### List, read, archive, delete

```http
GET    /api/workouts/programs?status=ACTIVE
GET    /api/workouts/programs/{id}
POST   /api/workouts/programs/{id}/archive
DELETE /api/workouts/programs/{id}
```

Archiving cancels the program's future `PLANNED` days and leaves every past
session and every piece of evidence alone. `DELETE` is for **drafts only** —
a live program has history hanging off it, and "delete" there means archive.

Another user's program id answers **404, never 403**.

---

### Health Domain

Nutrition behaviours and optional body-weight tracking (PRD §46, §47). The
rules behind them are in
[`docs/specs/health-domain.md`](specs/health-domain.md) §8–§9.
**Behaviours, not calories**: there is no macro, no food database, no BMI and no
goal weight in this section, by design (VISION §16).

#### Nutrition behaviours

```http
GET  /api/nutrition/behaviors
POST /api/nutrition/behaviors/{key}/commit   { "repeatDays": 5 }
```

A static registry — eleven behaviours with a title, a description, a natural
time of day and **two sizes**. The minimum version is never zero: "protein with
one meal" is what somebody does on the worst Tuesday of the month, and it is
shown up front rather than offered after a failure.

`commit` creates `repeatDays` consecutive **ordinary HEALTH commitments** through
the same service quick add uses, carrying the registry's copy and both sizes.
The alternative — a `nutrition_commitments` table — would give the product a
second kind of intention that Today, the weekly review and the momentum engine
would each have to learn about separately.

#### Weight

```http
PUT    /api/health/weight        { "dateLocal": "2026-09-05", "weightKg": 82.4 }
GET    /api/health/weight?from=&to=
DELETE /api/health/weight/{dateLocal}
```

```json
{
  "data": {
    "items": [{ "dateLocal": "2026-09-05", "weightKg": 82.4 }],
    "trend": [{ "dateLocal": "2026-09-05", "rolling7Kg": 82.7 }],
    "summary": { "first": 83.0, "last": 82.7, "deltaKg": -0.3, "days": 21 }
  }
}
```

PRD §47 is unusually explicit about what this must **not** do. Body weight moves
two kilos on salt, sleep and the time of day, so:

- The series is a **rolling seven-day mean**, `null` where fewer than two
  readings fall in the window. A "trend" through one point is a line the reader
  will take as a direction, and it has none.
- **There is no per-day judgment field, anywhere.** Not a classification, not an
  arrow, not a goal. The promise is that one measurement is never called a bad
  day, and the way to keep it is for the field not to exist — a client cannot
  render a red day it was never given. A test snapshots the key list.
- One row per local date, upserted. A future date is **400
  `WEIGHT_DATE_IN_FUTURE`**: it would sit at the right-hand end of every chart
  and drag the trend towards a number nobody has stood on a scale for.
- The audit row records the **date and nothing else**. A person's body weight in
  an operational log is a thing they did not agree to.

`/api/health/weight` shares a URL prefix with the liveness probe and shares
nothing else: the probe's routes are `@Public()` one decorator at a time, and no
path-based exemption for `/health*` exists anywhere in `auth/`.

---

---

## HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 204 | No Content - Request successful, no response body |
| 400 | Bad Request - Invalid request format or validation error |
| 401 | Unauthorized - Missing or invalid authentication token |
| 403 | Forbidden - Insufficient permissions or user disabled |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource already exists or version mismatch (optimistic concurrency) |
| 500 | Internal Server Error - Server error occurred |
| 503 | Service Unavailable - Service temporarily unavailable |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_REQUIRED` | 401 | No valid authentication token provided |
| `INVALID_TOKEN` | 401 | JWT token is invalid or expired |
| `FORBIDDEN` | 403 | User does not have required permissions |
| `USER_DISABLED` | 403 | User account is disabled |
| `NOT_FOUND` | 404 | Requested resource not found |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `CONFLICT` | 409 | Resource already exists or version mismatch |
| `NOT_AUTHORIZED` | 403 | Email not in allowlist |
| `VERSION_MISMATCH` | 409 | Optimistic concurrency conflict (If-Match header) |
| `AI_KEY_REQUIRED` | 412 | The caller has no OpenAI key. Complete `/setup/ai-key`. |

Endpoint-specific discriminators live under `details`, not in `code`: `code` is
a **closed enum derived from the HTTP status** (`common/dto/error.dto.ts` is the
contract, and the filter overwrites any `code` an exception supplied). A
commitment transition the matrix forbids is therefore a `CONFLICT` carrying
`details.reason = "INVALID_TRANSITION"`, which is what a client branches on.
Zod rejections put their failing field paths in the same `details` slot.

`AI_KEY_REQUIRED` is the one error body in this API that is sent **verbatim**
rather than rebuilt by the shared envelope — the filter's status-derived
rewriting would turn its `code` into `ERROR`, destroying the only discriminator
the web app has for "this user's key is gone". 412 rather than 401 or 403: the
caller *is* authenticated and *is* authorised, and a precondition of their own
resource is unmet. A 401 would send the client off to refresh a perfectly good
token; a 403 would tell them they lack a permission they hold.

---

## Rate Limits

> **Note:** General rate limiting is recommended for production deployments but
> is not implemented. Consider `@nestjs/throttler` or Nginx rate limiting before
> production deployment.

### Implemented throttles

Five endpoints are throttled today, because each one puts a request on
OpenAI's network under somebody's key on a click. A refused attempt is a real
**429** with `Retry-After` — the request was refused rather than attempted, so
there is no diagnosis to return and nothing is audited.

| Endpoint | Limit | Bucket |
|---|---|---|
| `POST /ai-settings/test` | 5 / minute / user | `admin_test` |
| `GET /ai-settings/models?refresh=true` | 10 / minute / user | `models_refresh` |
| `POST /me/ai-key/test` | 5 / minute / user | `user_test` |
| `POST /memory-insights/propose` | 1 / 10 minutes / user | `memory_propose` |
| `POST /weekly/reviews/generate` | 5 / hour / user | `weekly_review` |

`GET /ai-settings/models` **without** `refresh` is deliberately not throttled: a
cached read costs nothing, and a throttled administrator must still be able to
render the page.

**These windows are per API process.** Two replicas therefore allow twice the
rate, and a restart forgets everything. That is acceptable for what they defend
against — an accidental loop and a bored click — and it is not a defence against
a determined caller. `@nestjs/throttler` with a Redis store is the upgrade path;
see `docs/specs/ai-configuration.md`.

**Recommended limits (not implemented):**

| Endpoint Pattern | Recommended Limit | Window |
|------------------|-------------------|--------|
| `/api/auth/*` | 10 requests | 1 minute |
| `/api/allowlist` (POST) | 30 requests | 1 minute |
| `/api/system-settings` (PUT/PATCH) | 30 requests | 1 minute |
| All other endpoints | 100 requests | 1 minute |

---

## OpenAPI Documentation

Interactive API documentation with request/response examples is available at:

**Development:** http://localhost:3535/api/docs

This serves a [Scalar](https://scalar.com) reference page (not Swagger UI) generated from the
OpenAPI 3.1 document at `/api/openapi.json`. It allows you to:
- Explore all endpoints, grouped into sections via `x-tagGroups`
- View request/response schemas, including the generated **Requires:** RBAC line per operation
- Test API calls directly from the browser
- Authenticate with one click via "Authorize with my session" (exchanges your existing browser
  session for an access token), a personal access token, or a device authorization grant

See [`docs/specs/api-documentation.md`](specs/api-documentation.md) for how the document is built.

---

## CORS Policy

The API uses a **same-origin architecture**. Both the frontend and API are served from the same host (via Nginx reverse proxy):

- Frontend: `http://localhost:3535/`
- API: `http://localhost:3535/api`

This eliminates CORS complexity and improves security. No cross-origin requests are required.

---

## Security Headers

All API responses include security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

## Versioning

The API currently does not use versioning (v1, v2, etc.). Breaking changes will be avoided when possible. When breaking changes are necessary, they will be:

1. Announced in advance
2. Documented in migration guides
3. Implemented with a transition period when feasible

For future versions, the API may adopt URL-based versioning: `/api/v2/...`
