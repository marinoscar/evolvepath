import request from 'supertest';
import { JwtService } from '@nestjs/jwt';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  createMockAdminUser,
  createMockViewerUser,
  authHeader,
} from '../helpers/auth-mock.helper';
import { CredentialsService } from '../../src/credentials/credentials.service';
import { OpenAiProvider } from '../../src/ai/providers/openai/openai.provider';
import { AiProviderError } from '../../src/ai/gateway/ai-errors';

// =============================================================================
// AI Settings Integration (issue #24, epic #20)
// =============================================================================
//
// HTTP-level coverage for the five `/api/ai-settings*` endpoints and the
// contract points that only mean something at the transport boundary:
//
//   * the platform key never appears ANYWHERE in a serialised response, checked
//     by grepping the whole JSON body rather than trusting named fields
//   * `/test` and `/models` answer HTTP 200 even when the provider refused —
//     the single most likely thing a later "fix" gets wrong
//   * `/test` is gated on system_settings:WRITE, not :read
//   * a stored-but-invalid row degrades the GET to 200 + defaults, never 500
//   * the throttles are real 4xx, and a throttled attempt is not audited
//
// `CredentialsService` and `OpenAiProvider` are overridden with controllable
// stubs; the controller, the settings service, the catalog and the test service
// are the REAL classes wired by `AppModule`.
// =============================================================================

const mockCredentials = {
  describe: jest.fn(),
  setSecret: jest.fn(),
  getSecret: jest.fn(),
};

const mockProvider = {
  kind: 'openai' as const,
  listModels: jest.fn(),
  generate: jest.fn(),
};

function okGeneration() {
  return {
    outputText: '{"ok":true}',
    refusal: null,
    usage: {
      inputTokens: 42,
      outputTokens: 7,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
    providerRequestId: 'req_1',
    responseModel: 'gpt-5.4',
    incompleteReason: null,
  };
}

describe('AI Settings Integration', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: CredentialsService, useValue: mockCredentials },
        { provide: OpenAiProvider, useValue: mockProvider },
      ],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();

    mockCredentials.describe.mockReset().mockResolvedValue(null);
    mockCredentials.setSecret.mockReset().mockResolvedValue(undefined);
    mockCredentials.getSecret.mockReset().mockResolvedValue('sk-platform-0000');

    mockProvider.listModels
      .mockReset()
      .mockResolvedValue([
        { id: 'gpt-5.4', created: 1 },
        { id: 'gpt-5.4-mini', created: 2 },
        { id: 'gpt-5.3', created: 3 },
        { id: 'gpt-4o', created: 4 },
        { id: 'gpt-5.5-realtime', created: 5 },
      ]);
    mockProvider.generate.mockReset().mockResolvedValue(okGeneration());

    context.prismaMock.auditEvent.create.mockResolvedValue({} as any);
    context.prismaMock.aiInvocation.create.mockResolvedValue({} as any);
  });

  /** A user holding ONLY `system_settings:read` — no write. */
  async function createReadOnlyUser(): Promise<{ accessToken: string }> {
    const jwtService = context.module.get<JwtService>(JwtService);
    const id = 'read-only-admin';
    const email = 'read-only-admin@example.com';

    context.prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id !== id && where?.email !== email) return null;
      return {
        id,
        email,
        displayName: null,
        providerDisplayName: 'Read Only Admin',
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [
          {
            role: {
              id: 'role-readonly',
              name: 'readonly',
              description: 'Read-only settings access',
              rolePermissions: [
                {
                  permission: {
                    id: 'perm-ssr',
                    name: 'system_settings:read',
                    description: 'Read system settings',
                  },
                },
              ],
            },
          },
        ],
      };
    });

    return { accessToken: jwtService.sign({ sub: id, email, roles: ['readonly'] }) };
  }

  function storeSettings(value: unknown, version = 1) {
    context.prismaMock.systemSettings.findUnique.mockResolvedValue({
      version,
      updatedAt: new Date(),
      updatedByUser: null,
      value,
    } as any);
  }

  function stubWrite(version = 0) {
    context.prismaMock.systemSettings.findUnique.mockResolvedValue(
      version === 0 ? null : ({ version } as any),
    );
    context.prismaMock.systemSettings.upsert.mockImplementation(
      async ({ create, update }: any) => ({
        id: 'settings-ai',
        key: 'ai',
        version: version + 1,
        updatedAt: new Date(),
        updatedByUser: null,
        value: create?.value ?? update?.value,
      }),
    );
  }

  const validBody = {
    provider: 'openai',
    enabled: true,
    defaultModel: 'gpt-5.4',
    personaModels: {},
  };

  // ==========================================================================
  // GET /api/ai-settings
  // ==========================================================================

  describe('GET /api/ai-settings', () => {
    it('returns 401 without auth', async () => {
      await request(context.app.getHttpServer())
        .get('/api/ai-settings')
        .expect(401);
    });

    it('returns 403 for a user without system_settings:read', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .get('/api/ai-settings')
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    it('reports the stored key as configured with only its mask', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings(validBody, 2);
      mockCredentials.describe.mockResolvedValue({
        purpose: 'ai:openai',
        name: 'platform',
        hint: '••••0000',
        label: 'OpenAI platform API key',
        updatedByUserId: admin.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(context.app.getHttpServer())
        .get('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.platformKeyStatus.configured).toBe(true);
      expect(response.body.data.platformKeyStatus.hint).toBe('••••0000');
      expect(response.body.data.version).toBe(2);
      // The masked read only; the plaintext path is never touched.
      expect(mockCredentials.getSecret).not.toHaveBeenCalled();
    });

    it('degrades a stored-but-invalid row to 200 with defaults and settingsError', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings({ provider: 'anthropic', enabled: 'yes' }, 5);

      const response = await request(context.app.getHttpServer())
        .get('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.settingsError).toEqual(expect.any(String));
      expect(response.body.data.provider).toBeNull();
      expect(response.body.data.enabled).toBe(false);
      expect(response.body.data.version).toBe(5);
    });
  });

  // ==========================================================================
  // PUT /api/ai-settings
  // ==========================================================================

  describe('PUT /api/ai-settings', () => {
    it('returns 403 for a read-only admin', async () => {
      const readOnly = await createReadOnlyUser();

      await request(context.app.getHttpServer())
        .put('/api/ai-settings')
        .set(authHeader(readOnly.accessToken))
        .send(validBody)
        .expect(403);
    });

    it('stores the key write-only and never echoes it back', async () => {
      const admin = await createMockAdminUser(context);
      stubWrite(0);
      mockCredentials.describe.mockResolvedValue({
        purpose: 'ai:openai',
        name: 'platform',
        hint: '••••0000',
        label: 'OpenAI platform API key',
        updatedByUserId: admin.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(context.app.getHttpServer())
        .put('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .set('If-Match', '0')
        .send({ ...validBody, platformApiKey: 'sk-platform-secret-0000' })
        .expect(200);

      expect(mockCredentials.setSecret).toHaveBeenCalledWith(
        'ai:openai',
        'platform',
        'sk-platform-secret-0000',
        expect.objectContaining({ updatedByUserId: admin.id }),
      );
      // Grep the whole body rather than trusting named fields.
      expect(JSON.stringify(response.body)).not.toContain(
        'sk-platform-secret-0000',
      );
      expect(response.body.data.platformKeyStatus.hint).toBe('••••0000');
    });

    it('preserves the stored key when the field is blank', async () => {
      const admin = await createMockAdminUser(context);
      stubWrite(0);

      await request(context.app.getHttpServer())
        .put('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .send({ ...validBody, platformApiKey: '' })
        .expect(200);

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });

    it('rejects a model below GPT 5.4 with 400', async () => {
      const admin = await createMockAdminUser(context);
      stubWrite(0);

      const response = await request(context.app.getHttpServer())
        .put('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .send({ ...validBody, defaultModel: 'gpt-5.3' })
        .expect(400);

      expect(response.body.message).toContain('gpt-5.3');
      expect(response.body.message).toContain('5.4');
    });

    it('rejects an unknown persona key with 400', async () => {
      const admin = await createMockAdminUser(context);
      stubWrite(0);

      await request(context.app.getHttpServer())
        .put('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .send({ ...validBody, personaModels: { bogus: 'gpt-5.4' } })
        .expect(400);
    });

    it('returns 409 on a stale If-Match', async () => {
      const admin = await createMockAdminUser(context);
      stubWrite(4);

      await request(context.app.getHttpServer())
        .put('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .set('If-Match', '2')
        .send(validBody)
        .expect(409);
    });

    it('writes an audit row carrying no key material', async () => {
      const admin = await createMockAdminUser(context);
      stubWrite(0);

      await request(context.app.getHttpServer())
        .put('/api/ai-settings')
        .set(authHeader(admin.accessToken))
        .send({ ...validBody, platformApiKey: 'sk-platform-secret-0000' })
        .expect(200);

      const audit = context.prismaMock.auditEvent.create.mock.calls[0][0].data;
      expect(audit.action).toBe('ai_settings:replace');
      expect(audit.meta.platformKeyReplaced).toBe(true);
      expect(JSON.stringify(audit.meta)).not.toContain('sk-platform-secret-0000');
    });
  });

  // ==========================================================================
  // GET /api/ai-settings/personas
  // ==========================================================================

  describe('GET /api/ai-settings/personas', () => {
    it('returns the registry in order, with media_analyst the only vision persona', async () => {
      const admin = await createMockAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/ai-settings/personas')
        .set(authHeader(admin.accessToken))
        .expect(200);

      const personas = response.body.data as Array<{
        key: string;
        capabilities: string[];
      }>;

      expect(personas.map((p) => p.key)).toEqual([
        'planner',
        'coach',
        'pattern_analyst',
        'workout_programmer',
        'weekly_reviewer',
        'notification_copywriter',
        'safety',
        'media_analyst',
      ]);
      expect(
        personas.filter((p) => p.capabilities.includes('vision')).map((p) => p.key),
      ).toEqual(['media_analyst']);
    });
  });

  // ==========================================================================
  // GET /api/ai-settings/models
  // ==========================================================================

  describe('GET /api/ai-settings/models', () => {
    it('filters everything below GPT 5.4 out of the catalog', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings(validBody);

      const response = await request(context.app.getHttpServer())
        .get('/api/ai-settings/models?refresh=true')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.success).toBe(true);
      expect(
        (response.body.data.models as Array<{ id: string }>).map((m) => m.id),
      ).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
      expect(response.body.data.source).toBe('live');
    });

    it('answers 200 with success: false when no platform key is stored', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings(validBody);
      mockCredentials.getSecret.mockResolvedValue(null);

      const response = await request(context.app.getHttpServer())
        .get('/api/ai-settings/models?refresh=true')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.success).toBe(false);
      expect(response.body.data.error).toMatch(/No platform API key/);
    });

    it('answers 200 with the provider error when the catalog fetch fails', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings(validBody);
      mockProvider.listModels.mockRejectedValue(
        new AiProviderError('auth', 'Incorrect API key provided: sk-***', 401),
      );

      const response = await request(context.app.getHttpServer())
        .get('/api/ai-settings/models?refresh=true')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.success).toBe(false);
      expect(response.body.data.error).toBe(
        'Incorrect API key provided: sk-***',
      );
    });

    it('throttles refresh at 10 per minute with Retry-After', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings(validBody);

      for (let i = 0; i < 10; i += 1) {
        await request(context.app.getHttpServer())
          .get('/api/ai-settings/models?refresh=true')
          .set(authHeader(admin.accessToken))
          .expect(200);
      }

      const denied = await request(context.app.getHttpServer())
        .get('/api/ai-settings/models?refresh=true')
        .set(authHeader(admin.accessToken))
        .expect(429);

      expect(denied.headers['retry-after']).toBeDefined();

      // A cached read is deliberately NOT throttled: a throttled administrator
      // must still be able to render the page.
      await request(context.app.getHttpServer())
        .get('/api/ai-settings/models')
        .set(authHeader(admin.accessToken))
        .expect(200);
    });
  });

  // ==========================================================================
  // POST /api/ai-settings/test
  // ==========================================================================

  describe('POST /api/ai-settings/test', () => {
    it('returns 403 for a read-only admin — looking is not spending', async () => {
      const readOnly = await createReadOnlyUser();

      await request(context.app.getHttpServer())
        .post('/api/ai-settings/test')
        .set(authHeader(readOnly.accessToken))
        .expect(403);
    });

    it('answers 200 with success: true and both checks passed', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings(validBody);

      const response = await request(context.app.getHttpServer())
        .post('/api/ai-settings/test')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.success).toBe(true);
      expect(response.body.data.checks).toEqual({
        listModels: 'passed',
        generate: 'passed',
      });
      expect(response.body.data.model).toBe('gpt-5.4');

      const row = context.prismaMock.aiInvocation.create.mock.calls[0][0].data;
      expect(row.keyScope).toBe('platform');
      expect(row.operation).toBe('test_connection');
    });

    it('answers 200 with success: false when no provider is selected', async () => {
      const admin = await createMockAdminUser(context);
      context.prismaMock.systemSettings.findUnique.mockResolvedValue(null);

      const response = await request(context.app.getHttpServer())
        .post('/api/ai-settings/test')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.success).toBe(false);
      expect(response.body.data.error).toMatch(/No AI provider is selected/);
    });

    it('throttles at 5 per minute and does not audit the refused attempt', async () => {
      const admin = await createMockAdminUser(context);
      storeSettings(validBody);

      for (let i = 0; i < 5; i += 1) {
        await request(context.app.getHttpServer())
          .post('/api/ai-settings/test')
          .set(authHeader(admin.accessToken))
          .expect(200);
      }

      const auditsAfterFive =
        context.prismaMock.auditEvent.create.mock.calls.length;

      const denied = await request(context.app.getHttpServer())
        .post('/api/ai-settings/test')
        .set(authHeader(admin.accessToken))
        .expect(429);

      expect(denied.headers['retry-after']).toBeDefined();
      // Refused rather than attempted: there is no diagnosis to record.
      expect(context.prismaMock.auditEvent.create.mock.calls).toHaveLength(
        auditsAfterFive,
      );
    });
  });
});
