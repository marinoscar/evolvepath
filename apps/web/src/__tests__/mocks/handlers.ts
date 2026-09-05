import { http, HttpResponse } from 'msw';

import { pathHandlers } from './pathHandlers';

// Use wildcard pattern to match relative URLs
const API_BASE = '*/api';

// Mock data
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  profileImageUrl: null,
  roles: [{ name: 'viewer' }],
  permissions: ['user_settings:read', 'user_settings:write'],
  isActive: true,
  createdAt: new Date().toISOString(),
  // Epic #20. MUTABLE through `setAiKeyConfigured` below, because
  // `RequireAiKey` (#29) gates the whole shell on it and a routing spec needs
  // to be able to drive it from the server's answer rather than by faking the
  // context. Configured by default so existing specs keep landing on the page
  // they are testing.
  aiKey: { configured: true, hint: '\u2022\u2022\u2022\u2022e2e1' },
};

const mockUserSettings = {
  theme: 'system',
  profile: {
    displayName: null,
    useProviderImage: true,
    customImageUrl: null,
  },
  updatedAt: new Date().toISOString(),
  version: 1,
};

const mockSystemSettings = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
  updatedAt: new Date().toISOString(),
  updatedBy: null,
  version: 1,
};

const mockProviders = [
  { name: 'google', authUrl: '/api/auth/google' },
];


// -----------------------------------------------------------------------------
// AI settings (epic #20)
// -----------------------------------------------------------------------------
//
// MUTABLE, unlike most of the fixtures above, because the page under test does
// a real edit cycle: load → change → PUT → adopt the response → save again with
// the new version. A frozen fixture cannot express `If-Match`, so it cannot
// exercise the 409 path — which is the one behaviour of the save that is worth
// a test.
//
// `resetAiSettingsState()` must run in a spec's `beforeEach`; the handlers hold
// process-wide state, and a spec that bumped `version` would otherwise change
// what the next spec sees.

interface AiSettingsState {
  provider: 'openai' | null;
  enabled: boolean;
  baseUrl?: string;
  defaultModel: string | null;
  personaModels: Record<string, string | null>;
  version: number;
}

const initialAiSettingsState = (): AiSettingsState => ({
  provider: null,
  enabled: false,
  defaultModel: null,
  personaModels: {},
  version: 0,
});

let aiSettingsState: AiSettingsState = initialAiSettingsState();
let aiPlatformKeyConfigured = false;

/** Restore the "fresh deployment" state. Call from `beforeEach`. */
export function resetAiSettingsState(): void {
  aiSettingsState = initialAiSettingsState();
  aiPlatformKeyConfigured = false;
}

/** Seed a stored configuration, e.g. to render a page that is already set up. */
export function setAiSettingsState(patch: Partial<AiSettingsState>): void {
  aiSettingsState = { ...aiSettingsState, ...patch };
}

/** Seed the masked platform-key status without ever holding a key. */
export function setAiPlatformKeyConfigured(configured: boolean): void {
  aiPlatformKeyConfigured = configured;
}

function aiSettingsResponse() {
  return {
    provider: aiSettingsState.provider,
    enabled: aiSettingsState.enabled,
    ...(aiSettingsState.baseUrl ? { baseUrl: aiSettingsState.baseUrl } : {}),
    defaultModel: aiSettingsState.defaultModel,
    personaModels: aiSettingsState.personaModels,
    platformKeyStatus: {
      configured: aiPlatformKeyConfigured,
      hint: aiPlatformKeyConfigured ? '\u2022\u2022\u2022\u20220000' : null,
      updatedAt: aiPlatformKeyConfigured ? new Date().toISOString() : null,
      updatedByUserId: null,
    },
    settingsError: null,
    version: aiSettingsState.version,
    updatedAt: new Date().toISOString(),
    updatedBy: null,
  };
}

/** The catalog the API would have filtered to GPT >= 5.4 already. */
const mockAiModels = [
  { id: 'gpt-5.4', created: 1772000000 },
  { id: 'gpt-5.4-mini', created: 1772000001 },
];

const mockAiPersonas = [
  {
    key: 'planner',
    label: 'Planner',
    description: 'Turns an aspiration into an outcome and a behavioural plan.',
    tier: 'reasoning',
    capabilities: ['text'],
  },
  {
    key: 'coach',
    label: 'Coach',
    description: 'Day-to-day coaching replies, help starting, and decomposition.',
    tier: 'fast',
    capabilities: ['text'],
  },
  {
    key: 'media_analyst',
    label: 'Media analyst',
    description: 'Describes workout form, equipment and meals from photos and video frames.',
    tier: 'fast',
    capabilities: ['text', 'vision'],
  },
];


// -----------------------------------------------------------------------------
// The caller's own OpenAI key (epic #20)
// -----------------------------------------------------------------------------

interface AiKeyState {
  configured: boolean;
  hint: string | null;
  lastTest: {
    attemptedAt: string;
    success: boolean;
    model: string | null;
    error: string | null;
  } | null;
}

const initialAiKeyState = (): AiKeyState => ({
  configured: true,
  hint: '\u2022\u2022\u2022\u2022e2e1',
  lastTest: null,
});

let aiKeyState: AiKeyState = initialAiKeyState();

/** Restore the default "a key is stored" state. Call from `beforeEach`. */
export function resetAiKeyState(): void {
  aiKeyState = initialAiKeyState();
  mockUser.aiKey = { configured: true, hint: '\u2022\u2022\u2022\u2022e2e1' };
}

/**
 * Drive the keyless state from the SERVER'S answer.
 *
 * Updates the `/auth/me` payload as well as `/me/ai-key`, because the gate
 * (#29) reads `user.aiKey` from `AuthContext` — a helper that changed only one
 * of the two would let a routing spec pass against a state the real app can
 * never be in.
 */
export function setAiKeyConfigured(configured: boolean): void {
  aiKeyState = {
    ...aiKeyState,
    configured,
    hint: configured ? '\u2022\u2022\u2022\u2022e2e1' : null,
  };
  mockUser.aiKey = { configured, hint: aiKeyState.hint };
}

/** Seed the outcome of a previous test, which the API derives from telemetry. */
export function setAiKeyLastTest(lastTest: AiKeyState['lastTest']): void {
  aiKeyState = { ...aiKeyState, lastTest };
}

function myAiKeyResponse() {
  return {
    configured: aiKeyState.configured,
    hint: aiKeyState.hint,
    updatedAt: aiKeyState.configured ? new Date().toISOString() : null,
    lastTest: aiKeyState.lastTest,
    platform: { provider: 'openai', enabled: true, hasDefaultModel: true },
  };
}

export const handlers = [
  // Auth endpoints
  http.get(`${API_BASE}/auth/providers`, () => {
    // Real API returns { providers: [...] } which gets unwrapped by api.ts
    return HttpResponse.json({ providers: mockProviders });
  }),

  http.get(`${API_BASE}/auth/me`, () => {
    return HttpResponse.json({ data: mockUser });
  }),

  http.post(`${API_BASE}/auth/logout`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}/auth/refresh`, () => {
    return HttpResponse.json({
      accessToken: 'new-mock-token',
      expiresIn: 900,
    });
  }),

  // User settings endpoints
  http.get(`${API_BASE}/user-settings`, () => {
    return HttpResponse.json({ data: mockUserSettings });
  }),

  http.put(`${API_BASE}/user-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...mockUserSettings,
        ...body,
        version: mockUserSettings.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  http.patch(`${API_BASE}/user-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...mockUserSettings,
        ...body,
        version: mockUserSettings.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  // System settings endpoints
  http.get(`${API_BASE}/system-settings`, () => {
    return HttpResponse.json({ data: mockSystemSettings });
  }),

  http.patch(`${API_BASE}/system-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...mockSystemSettings,
        ...body,
        version: mockSystemSettings.version + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  http.put(`${API_BASE}/system-settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      data: {
        ...body,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
        version: 1,
      },
    });
  }),

  // Users endpoints
  http.get(`${API_BASE}/users`, () => {
    return HttpResponse.json({
      items: [
        {
          id: mockUser.id,
          email: mockUser.email,
          displayName: mockUser.displayName,
          providerDisplayName: 'Test User (Provider)',
          profileImageUrl: mockUser.profileImageUrl,
          providerProfileImageUrl: null,
          isActive: mockUser.isActive,
          roles: mockUser.roles.map((r) => r.name),
          createdAt: mockUser.createdAt,
          updatedAt: mockUser.createdAt,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  }),

  http.get(`${API_BASE}/users/:id`, ({ params }) => {
    if (params.id === mockUser.id) {
      return HttpResponse.json({ data: mockUser });
    }
    return new HttpResponse(null, { status: 404 });
  }),

  http.patch(`${API_BASE}/users/:id`, async ({ params, request }) => {
    if (params.id === mockUser.id) {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        id: mockUser.id,
        email: mockUser.email,
        displayName: (body.displayName as string | null) ?? mockUser.displayName,
        providerDisplayName: 'Test User (Provider)',
        profileImageUrl: mockUser.profileImageUrl,
        providerProfileImageUrl: null,
        isActive: body.isActive !== undefined ? (body.isActive as boolean) : mockUser.isActive,
        roles: mockUser.roles.map((r) => r.name),
        createdAt: mockUser.createdAt,
        updatedAt: new Date().toISOString(),
      });
    }
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  http.put(`${API_BASE}/users/:id/roles`, async ({ params, request }) => {
    if (params.id === mockUser.id) {
      const body = (await request.json()) as { roles: string[] };
      return HttpResponse.json({
        id: mockUser.id,
        email: mockUser.email,
        displayName: mockUser.displayName,
        providerDisplayName: 'Test User (Provider)',
        profileImageUrl: mockUser.profileImageUrl,
        providerProfileImageUrl: null,
        isActive: mockUser.isActive,
        roles: body.roles,
        createdAt: mockUser.createdAt,
        updatedAt: new Date().toISOString(),
      });
    }
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  // Health endpoints
  http.get(`${API_BASE}/health/live`, () => {
    return HttpResponse.json({
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    });
  }),

  http.get(`${API_BASE}/health/ready`, () => {
    return HttpResponse.json({
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'ok',
        },
      },
    });
  }),

  // Device Authorization endpoints
  http.get(`${API_BASE}/auth/device/activate`, ({ request }) => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    // Default success response
    return HttpResponse.json({
      data: {
        userCode: code || 'ABCD-1234',
        clientInfo: {
          deviceName: 'My Smart TV',
          userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
          ipAddress: '192.168.1.100',
        },
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    });
  }),

  http.post(`${API_BASE}/auth/device/authorize`, async ({ request }) => {
    const body = (await request.json()) as { userCode: string; approve: boolean };

    return HttpResponse.json({
      data: {
        success: body.approve,
        message: body.approve
          ? 'Device authorized successfully!'
          : 'Device access denied.',
      },
    });
  }),
  // --- AI settings (epic #20) ------------------------------------------------

  http.get(`${API_BASE}/ai-settings`, () => {
    return HttpResponse.json({ data: aiSettingsResponse() });
  }),

  http.put(`${API_BASE}/ai-settings`, async ({ request }) => {
    const body = (await request.json()) as {
      provider: 'openai' | null;
      enabled: boolean;
      baseUrl?: string | null;
      defaultModel: string | null;
      personaModels: Record<string, string | null>;
      platformApiKey?: string;
    };

    // `If-Match` is honoured for real, so the 409 path is reachable.
    const ifMatch = request.headers.get('if-match');
    if (ifMatch !== null && Number(ifMatch) !== aiSettingsState.version) {
      return HttpResponse.json(
        { message: 'AI settings version mismatch', code: 'CONFLICT' },
        { status: 409 },
      );
    }

    // The API's model floor, reproduced so a spec can drive the 400.
    const named = [
      body.defaultModel,
      ...Object.values(body.personaModels ?? {}),
    ].filter((model): model is string => typeof model === 'string');

    for (const model of named) {
      const match = /^gpt-(\d+)(?:\.(\d+))?/i.exec(model);
      const major = match ? Number(match[1]) : 0;
      const minor = match && match[2] ? Number(match[2]) : 0;
      if (!match || major < 5 || (major === 5 && minor < 4)) {
        return HttpResponse.json(
          {
            message: `Model "${model}" is not supported: EvolvePath requires GPT 5.4 or newer.`,
            code: 'BAD_REQUEST',
          },
          { status: 400 },
        );
      }
    }

    // BLANK PRESERVES: a request with no `platformApiKey` leaves the stored
    // status alone. The mock never holds the key itself — there is nothing here
    // that could return one.
    if (body.platformApiKey) aiPlatformKeyConfigured = true;

    aiSettingsState = {
      provider: body.provider,
      enabled: body.enabled,
      ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
      defaultModel: body.defaultModel,
      personaModels: body.personaModels ?? {},
      version: aiSettingsState.version + 1,
    };

    return HttpResponse.json({ data: aiSettingsResponse() });
  }),

  http.get(`${API_BASE}/ai-settings/personas`, () => {
    return HttpResponse.json({ data: mockAiPersonas });
  }),

  http.get(`${API_BASE}/ai-settings/models`, () => {
    // 200 even with no key configured — the endpoint reports failure in the
    // body, never through the status.
    return HttpResponse.json({
      data: aiPlatformKeyConfigured
        ? {
            success: true,
            models: mockAiModels,
            fetchedAt: new Date().toISOString(),
            source: 'live',
            error: null,
          }
        : {
            success: false,
            models: [],
            fetchedAt: null,
            source: null,
            error: 'No platform API key is configured. Save one, then refresh.',
          },
    });
  }),

  http.post(`${API_BASE}/ai-settings/test`, () => {
    return HttpResponse.json({
      data: {
        success: true,
        providerKind: 'openai',
        model: aiSettingsState.defaultModel,
        latencyMs: 412,
        error: null,
        attemptedAt: new Date().toISOString(),
        checks: {
          listModels: 'passed',
          generate: aiSettingsState.defaultModel ? 'passed' : 'skipped',
        },
      },
    });
  }),
  // --- the caller's own OpenAI key (epic #20) --------------------------------

  http.get(`${API_BASE}/me/ai-key`, () => {
    return HttpResponse.json({ data: myAiKeyResponse() });
  }),

  http.put(`${API_BASE}/me/ai-key`, async ({ request }) => {
    const body = (await request.json()) as { apiKey?: string };
    const apiKey = body.apiKey ?? '';

    // The API's own rules, reproduced so a spec can drive the 400: 20-512
    // characters, no whitespace anywhere. There is deliberately no `sk-` rule.
    if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
      return HttpResponse.json(
        {
          message: 'That key looks too short. Copy the whole value from OpenAI.',
          code: 'BAD_REQUEST',
        },
        { status: 400 },
      );
    }

    setAiKeyConfigured(true);
    return HttpResponse.json({ data: myAiKeyResponse() });
  }),

  http.delete(`${API_BASE}/me/ai-key`, () => {
    setAiKeyConfigured(false);
    // Idempotent 204: removing a key that is not there succeeds.
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}/me/ai-key/test`, () => {
    return HttpResponse.json({
      data: {
        success: true,
        providerKind: 'openai',
        model: 'gpt-5.4',
        latencyMs: 210,
        error: null,
        attemptedAt: new Date().toISOString(),
        checks: { listModels: 'passed', generate: 'passed' },
      },
    });
  }),

  // The EvolvePath product domain (#56, epic #33), in its own file: a stateful
  // store with the transition matrix enforced, rather than canned responses.
  ...pathHandlers,
];
