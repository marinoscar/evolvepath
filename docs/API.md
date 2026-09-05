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
  "aiKey": { "configured": true, "hint": "••••abcd" }
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

#### EvolvePath errors

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` | Zod rejected the body, query or path parameter. `details` carries the failing paths. |
| 401 | `UNAUTHORIZED` | No bearer token, or an expired one. |
| 404 | `NOT_FOUND` | The id is unknown **or** belongs to another user — deliberately indistinguishable. |
| 409 | `CONFLICT` | A state-machine violation: an edit to an archived outcome, a second plan for one outcome, a second draft, an activate/edit/reject on the wrong version status, a write to a read-only version's routines, or a losing activation race. The message names the current status. |

---

### Storage Objects

The storage system provides file upload and management capabilities with support for large files (GB scale) through resumable multipart uploads.

#### Initialize Resumable Upload

`POST /api/storage/objects/upload/init`

**Requires Authentication** - Initialize a multipart upload for large files. Returns presigned URLs for direct-to-S3 uploads.

**Request Body:**
```json
{
  "name": "document.pdf",
  "size": 104857600,
  "mimeType": "application/pdf"
}
```

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

Three endpoints are throttled today, because each one puts a request on
OpenAI's network under somebody's key on a click. A refused attempt is a real
**429** with `Retry-After` — the request was refused rather than attempted, so
there is no diagnosis to return and nothing is audited.

| Endpoint | Limit | Bucket |
|---|---|---|
| `POST /ai-settings/test` | 5 / minute / user | `admin_test` |
| `GET /ai-settings/models?refresh=true` | 10 / minute / user | `models_refresh` |
| `POST /me/ai-key/test` | 5 / minute / user | `user_test` |

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
