import request from 'supertest';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  createMockViewerUser,
  authHeader,
} from '../helpers/auth-mock.helper';
import { CredentialsService } from '../../src/credentials/credentials.service';
import { OpenAiProvider } from '../../src/ai/providers/openai/openai.provider';
import { AiProviderError } from '../../src/ai/gateway/ai-errors';

// =============================================================================
// User AI Key Integration (issue #25, epic #20)
// =============================================================================
//
// HTTP-level coverage for `/api/me/ai-key*` and the `aiKey` field on
// `/api/auth/me`. The contract points that only mean something at the transport
// boundary:
//
//   * a VIEWER — the least privileged role — can do all four operations, because
//     without a key they cannot use the application at all
//   * the submitted key never appears in any serialised response, checked by
//     grepping the whole body
//   * `/test` answers 200 with OpenAI's own text when the key is refused
//   * DELETE is idempotent 204
//   * `aiKey.configured` on `/auth/me` tracks a PUT and a DELETE
// =============================================================================

const KEY = 'sk-user-integration-000000';

const mockCredentials = {
  describe: jest.fn(),
  setSecret: jest.fn(),
  deleteSecret: jest.fn(),
  getSecret: jest.fn(),
};

const mockProvider = {
  kind: 'openai' as const,
  listModels: jest.fn(),
  generate: jest.fn(),
};

describe('User AI Key Integration', () => {
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
    mockCredentials.deleteSecret.mockReset().mockResolvedValue(undefined);
    mockCredentials.getSecret.mockReset().mockResolvedValue(KEY);

    mockProvider.listModels
      .mockReset()
      .mockResolvedValue([{ id: 'gpt-5.4', created: 1 }]);
    mockProvider.generate.mockReset().mockResolvedValue({
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
    });

    context.prismaMock.auditEvent.create.mockResolvedValue({} as any);
    context.prismaMock.aiInvocation.create.mockResolvedValue({} as any);
    context.prismaMock.aiInvocation.findFirst.mockResolvedValue(null);
    context.prismaMock.systemSettings.findUnique.mockResolvedValue(null);
  });

  /** Pretend a key is (or is not) stored, for the masked reads. */
  function storeKey(stored: boolean) {
    mockCredentials.describe.mockResolvedValue(
      stored
        ? {
            purpose: 'ai:openai:user',
            name: 'viewer',
            hint: '••••0000',
            label: 'OpenAI API key',
            updatedByUserId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
    );
  }

  it('lets a Viewer read their own key status', async () => {
    const viewer = await createMockViewerUser(context);

    const response = await request(context.app.getHttpServer())
      .get('/api/me/ai-key')
      .set(authHeader(viewer.accessToken))
      .expect(200);

    expect(response.body.data.configured).toBe(false);
    expect(response.body.data.lastTest).toBeNull();
    expect(response.body.data.platform).toEqual({
      provider: null,
      enabled: false,
      hasDefaultModel: false,
    });
  });

  it('returns 401 without auth', async () => {
    await request(context.app.getHttpServer())
      .get('/api/me/ai-key')
      .expect(401);
  });

  it('lets a Viewer save a key, and never echoes it back', async () => {
    const viewer = await createMockViewerUser(context);
    storeKey(false);

    const response = await request(context.app.getHttpServer())
      .put('/api/me/ai-key')
      .set(authHeader(viewer.accessToken))
      .send({ apiKey: KEY })
      .expect(200);

    expect(mockCredentials.setSecret).toHaveBeenCalledWith(
      'ai:openai:user',
      viewer.id,
      KEY,
      expect.objectContaining({ label: 'OpenAI API key' }),
    );
    // Grep the whole body rather than trusting named fields.
    expect(JSON.stringify(response.body)).not.toContain(KEY);
  });

  it.each([
    ['too short', 'short'],
    ['containing a space', 'has space in it 12345678'],
  ])('rejects a key %s with 400', async (_label, apiKey) => {
    const viewer = await createMockViewerUser(context);

    await request(context.app.getHttpServer())
      .put('/api/me/ai-key')
      .set(authHeader(viewer.accessToken))
      .send({ apiKey })
      .expect(400);

    expect(mockCredentials.setSecret).not.toHaveBeenCalled();
  });

  it('flips aiKey.configured on /auth/me across a PUT and a DELETE', async () => {
    const viewer = await createMockViewerUser(context);

    const me = () =>
      request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(viewer.accessToken))
        .expect(200);

    storeKey(false);
    expect((await me()).body.data.aiKey).toEqual({
      configured: false,
      hint: null,
    });

    storeKey(true);
    const withKey = await me();
    expect(withKey.body.data.aiKey).toEqual({
      configured: true,
      hint: '••••0000',
    });
    // The key is never returned, even alongside the flag that says it exists.
    expect(JSON.stringify(withKey.body)).not.toContain(KEY);

    await request(context.app.getHttpServer())
      .delete('/api/me/ai-key')
      .set(authHeader(viewer.accessToken))
      .expect(204);

    storeKey(false);
    expect((await me()).body.data.aiKey.configured).toBe(false);
  });

  it('answers 204 to a repeated DELETE', async () => {
    const viewer = await createMockViewerUser(context);
    storeKey(false);

    await request(context.app.getHttpServer())
      .delete('/api/me/ai-key')
      .set(authHeader(viewer.accessToken))
      .expect(204);
    await request(context.app.getHttpServer())
      .delete('/api/me/ai-key')
      .set(authHeader(viewer.accessToken))
      .expect(204);
  });

  it("answers 200 with OpenAI's verbatim refusal when the key is wrong", async () => {
    const viewer = await createMockViewerUser(context);
    mockProvider.listModels.mockRejectedValue(
      new AiProviderError('auth', 'Incorrect API key provided: sk-***', 401),
    );

    const response = await request(context.app.getHttpServer())
      .post('/api/me/ai-key/test')
      .set(authHeader(viewer.accessToken))
      .expect(200);

    expect(response.body.data.success).toBe(false);
    expect(response.body.data.error).toBe('Incorrect API key provided: sk-***');

    const row = context.prismaMock.aiInvocation.create.mock.calls[0][0].data;
    expect(row.keyScope).toBe('user');
    expect(row.userId).toBe(viewer.id);
  });

  it('reflects the latest invocation in lastTest', async () => {
    const viewer = await createMockViewerUser(context);
    storeKey(true);
    context.prismaMock.aiInvocation.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-02T00:00:00Z'),
      status: 'succeeded',
      model: 'gpt-5.4',
      errorMessage: null,
    } as any);

    const response = await request(context.app.getHttpServer())
      .get('/api/me/ai-key')
      .set(authHeader(viewer.accessToken))
      .expect(200);

    expect(response.body.data.lastTest).toEqual({
      attemptedAt: '2026-09-02T00:00:00.000Z',
      success: true,
      model: 'gpt-5.4',
      error: null,
    });
  });

  it('throttles the test at 5 per minute with Retry-After', async () => {
    const viewer = await createMockViewerUser(context);

    for (let i = 0; i < 5; i += 1) {
      await request(context.app.getHttpServer())
        .post('/api/me/ai-key/test')
        .set(authHeader(viewer.accessToken))
        .expect(200);
    }

    const denied = await request(context.app.getHttpServer())
      .post('/api/me/ai-key/test')
      .set(authHeader(viewer.accessToken))
      .expect(429);

    expect(denied.headers['retry-after']).toBeDefined();
  });

  describe('POST /api/auth/test/login with withAiKey', () => {
    beforeEach(() => {
      context.prismaMock.role.findUnique.mockResolvedValue({
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer',
      } as any);
      context.prismaMock.$transaction.mockResolvedValue([] as any);
      context.prismaMock.refreshToken.create.mockResolvedValue({} as any);
    });

    function stubTestUser(email: string) {
      const user = {
        id: 'seeded-user-id',
        email,
        displayName: 'seeded',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: { id: 'role-viewer', name: 'viewer' } }],
      };
      context.prismaMock.user.findUnique.mockResolvedValue(user as any);
      context.prismaMock.user.create.mockResolvedValue(user as any);
    }

    it('seeds a recognisably synthetic key when sent as JSON true', async () => {
      stubTestUser('seed-json@example.com');

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'seed-json@example.com', role: 'viewer', withAiKey: true })
        // 302: the endpoint redirects the browser to /auth/callback.
        .expect(302);

      const [purpose, , value] = mockCredentials.setSecret.mock.calls[0]!;
      expect(purpose).toBe('ai:openai:user');
      expect(String(value)).toMatch(/^sk-test-e2e-/);
    });

    it("seeds a key when the native form sends the checkbox as 'on'", async () => {
      // The /testing/login page is a plain <form method="POST">, so a ticked
      // checkbox arrives as the STRING 'on'.
      stubTestUser('seed-form@example.com');

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .type('form')
        .send('email=seed-form@example.com&role=viewer&withAiKey=on')
        .expect(302);

      expect(mockCredentials.setSecret).toHaveBeenCalledWith(
        'ai:openai:user',
        'seeded-user-id',
        expect.stringMatching(/^sk-test-e2e-/),
        expect.anything(),
      );
    });

    it('seeds nothing when the box is left unticked', async () => {
      stubTestUser('seed-none@example.com');

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .type('form')
        .send('email=seed-none@example.com&role=viewer')
        .expect(302);

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });
  });
});
