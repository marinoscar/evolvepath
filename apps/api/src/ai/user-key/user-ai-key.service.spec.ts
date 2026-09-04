import { UserAiKeyService } from './user-ai-key.service';
import { AiProviderError } from '../gateway/ai-errors';
import { DEFAULT_AI_SETTINGS } from '../ai-settings.schema';
import {
  AI_PLATFORM_CREDENTIAL_PURPOSE,
  AI_USER_CREDENTIAL_PURPOSE,
} from '../ai-credential.constants';
import { SetUserAiKeyDto } from './dto/set-user-ai-key.dto';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('UserAiKeyService', () => {
  const platformConfigured = {
    ...DEFAULT_AI_SETTINGS,
    provider: 'openai' as const,
    enabled: true,
    defaultModel: 'gpt-5.4',
  };

  let prisma: {
    aiInvocation: { create: jest.Mock; findFirst: jest.Mock };
    auditEvent: { create: jest.Mock };
  };
  let credentials: {
    describe: jest.Mock;
    setSecret: jest.Mock;
    deleteSecret: jest.Mock;
    getSecret: jest.Mock;
  };
  let settings: { get: jest.Mock; resolveBaseUrl: jest.Mock };
  let provider: { listModels: jest.Mock; generate: jest.Mock };
  let service: UserAiKeyService;

  beforeEach(() => {
    prisma = {
      aiInvocation: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    credentials = {
      describe: jest.fn().mockResolvedValue(null),
      setSecret: jest.fn().mockResolvedValue(undefined),
      deleteSecret: jest.fn().mockResolvedValue(undefined),
      getSecret: jest.fn().mockResolvedValue('sk-user-key-000000000000'),
    };
    settings = {
      get: jest.fn().mockResolvedValue(platformConfigured),
      resolveBaseUrl: jest.fn().mockReturnValue('https://api.openai.com/v1'),
    };
    provider = {
      listModels: jest.fn().mockResolvedValue([{ id: 'gpt-5.4', created: 1 }]),
      generate: jest.fn().mockResolvedValue({
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
      }),
    };

    service = new UserAiKeyService(
      prisma as never,
      credentials as never,
      settings as never,
      { get: () => provider } as never,
      { get: () => 60000 } as never,
    );
  });

  describe('set', () => {
    it('stores the key at the per-user address, untouched', async () => {
      await service.set(USER_ID, 'sk-user-key-000000000000');

      expect(credentials.setSecret).toHaveBeenCalledWith(
        AI_USER_CREDENTIAL_PURPOSE,
        USER_ID,
        'sk-user-key-000000000000',
        expect.objectContaining({ updatedByUserId: USER_ID }),
      );
    });

    it('audits replaced: false on a first write and true on a second', async () => {
      await service.set(USER_ID, 'sk-user-key-000000000000');
      expect(
        prisma.auditEvent.create.mock.calls[0]![0].data.meta.replaced,
      ).toBe(false);

      credentials.describe.mockResolvedValue({ hint: '••••0000' });
      await service.set(USER_ID, 'sk-user-key-111111111111');
      expect(
        prisma.auditEvent.create.mock.calls[1]![0].data.meta.replaced,
      ).toBe(true);
    });

    it('never puts the key or its hint in the audit row', async () => {
      credentials.describe.mockResolvedValue({ hint: '••••0000' });

      await service.set(USER_ID, 'sk-user-key-000000000000');

      const meta = JSON.stringify(
        prisma.auditEvent.create.mock.calls[0]![0].data.meta,
      );
      expect(meta).not.toContain('sk-user-key');
      expect(meta).not.toContain('••••');
    });
  });

  describe('deleteForUser', () => {
    it('audits a real removal', async () => {
      credentials.describe.mockResolvedValue({ hint: '••••0000' });

      await service.deleteForUser(USER_ID);

      expect(credentials.deleteSecret).toHaveBeenCalledWith(
        AI_USER_CREDENTIAL_PURPOSE,
        USER_ID,
      );
      expect(prisma.auditEvent.create.mock.calls[0]![0].data.action).toBe(
        'ai_user_key:delete',
      );
    });

    it('is idempotent and does not audit a no-op', async () => {
      // Nothing stored: the DELETE still succeeds, but recording it would fill
      // the trail with events describing nothing.
      await expect(service.deleteForUser(USER_ID)).resolves.toBeUndefined();

      expect(credentials.deleteSecret).toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('reports no key and no last test on a fresh account', async () => {
      const status = await service.status(USER_ID);

      expect(status.configured).toBe(false);
      expect(status.hint).toBeNull();
      expect(status.lastTest).toBeNull();
      expect(status.platform).toEqual({
        provider: 'openai',
        enabled: true,
        hasDefaultModel: true,
      });
    });

    it('derives lastTest from the most recent user-scoped invocation', async () => {
      credentials.describe.mockResolvedValue({
        hint: '••••0000',
        updatedAt: new Date('2026-09-01T00:00:00Z'),
      });
      prisma.aiInvocation.findFirst.mockResolvedValue({
        createdAt: new Date('2026-09-02T00:00:00Z'),
        status: 'failed',
        model: null,
        errorMessage: 'Incorrect API key provided: sk-***',
      });

      const status = await service.status(USER_ID);

      expect(prisma.aiInvocation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER_ID,
            operation: 'test_connection',
            keyScope: 'user',
          },
        }),
      );
      expect(status.lastTest).toEqual({
        attemptedAt: '2026-09-02T00:00:00.000Z',
        success: false,
        model: null,
        error: 'Incorrect API key provided: sk-***',
      });
    });

    it('degrades an unreadable settings row to "nothing configured"', async () => {
      // A problem only an administrator can fix must not make a user's own key
      // page un-renderable.
      settings.get.mockRejectedValue(new Error('Stored AI settings are invalid'));

      const status = await service.status(USER_ID);

      expect(status.platform).toEqual({
        provider: null,
        enabled: false,
        hasDefaultModel: false,
      });
    });
  });

  describe('test', () => {
    it('refuses as a result when no key is saved', async () => {
      credentials.getSecret.mockResolvedValue(null);

      const result = await service.test(USER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'No OpenAI API key is saved for your account.',
      );
      expect(provider.listModels).not.toHaveBeenCalled();
      // Still recorded, so `lastTest` reflects the attempt.
      expect(prisma.aiInvocation.create).toHaveBeenCalled();
    });

    it('uses the user key for both probes and never the platform key', async () => {
      await service.test(USER_ID);

      expect(credentials.getSecret).toHaveBeenCalledWith(
        AI_USER_CREDENTIAL_PURPOSE,
        USER_ID,
      );
      expect(credentials.getSecret).not.toHaveBeenCalledWith(
        AI_PLATFORM_CREDENTIAL_PURPOSE,
        expect.anything(),
      );
      expect(provider.listModels.mock.calls[0]![0].apiKey).toBe(
        'sk-user-key-000000000000',
      );
      expect(provider.generate.mock.calls[0]![0].apiKey).toBe(
        'sk-user-key-000000000000',
      );
    });

    it('records a user-scoped invocation row', async () => {
      await service.test(USER_ID);

      const row = prisma.aiInvocation.create.mock.calls[0]![0].data;
      expect(row.keyScope).toBe('user');
      expect(row.userId).toBe(USER_ID);
      expect(row.operation).toBe('test_connection');
      expect(row.status).toBe('succeeded');
    });

    it.each([
      ['no provider selected', { ...DEFAULT_AI_SETTINGS }],
      ['AI switched off', { ...platformConfigured, enabled: false }],
      ['no default model', { ...platformConfigured, defaultModel: null }],
    ])('still proves the key but skips generate when %s', async (_l, stored) => {
      settings.get.mockResolvedValue(stored);

      const result = await service.test(USER_ID);

      // The administrator's empty model selection is not the user's problem,
      // so it is 'skipped' and the test still succeeds.
      expect(result.success).toBe(true);
      expect(result.checks).toEqual({ listModels: 'passed', generate: 'skipped' });
      expect(result.model).toBeNull();
      expect(provider.generate).not.toHaveBeenCalled();
    });

    it("surfaces the provider's verbatim 401 text", async () => {
      provider.listModels.mockRejectedValue(
        new AiProviderError('auth', 'Incorrect API key provided: sk-***', 401),
      );

      const result = await service.test(USER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Incorrect API key provided: sk-***');
      expect(prisma.aiInvocation.create.mock.calls[0]![0].data.errorCode).toBe(
        'auth',
      );
    });

    it('audits every attempt', async () => {
      await service.test(USER_ID);

      const audit = prisma.auditEvent.create.mock.calls[0]![0].data;
      expect(audit.action).toBe('ai_user_key:test');
      expect(audit.targetId).toBe(USER_ID);
      expect(JSON.stringify(audit.meta)).not.toContain('sk-user-key');
    });

    it('still answers when the telemetry write fails', async () => {
      prisma.aiInvocation.create.mockRejectedValue(new Error('db down'));

      await expect(service.test(USER_ID)).resolves.toMatchObject({
        success: true,
      });
    });
  });
});

describe('SetUserAiKeyDto', () => {
  const parse = (apiKey: unknown) =>
    (SetUserAiKeyDto as unknown as { schema: { safeParse(v: unknown): { success: boolean } } })
      .schema.safeParse({ apiKey });

  it('rejects a truncated paste', () => {
    expect(parse('sk-nineteen-chars12').success).toBe(false);
  });

  it('accepts exactly twenty characters', () => {
    expect(parse('sk-twenty-chars-0000').success).toBe(true);
  });

  it('rejects internal whitespace rather than trimming it away', () => {
    // A line-wrapped paste. Storing it intact would fail authentication forever
    // with nothing to explain why.
    expect(parse('sk-has space in it 12345678').success).toBe(false);
    expect(parse('sk-has\nnewline-000000000').success).toBe(false);
  });

  it('does not require an sk- prefix', () => {
    // OpenAI has changed key formats before; a server-side prefix rule turns
    // that into an outage for every user at once.
    expect(parse('not-an-sk-prefix-0000').success).toBe(true);
  });

  it('rejects a value over 512 characters', () => {
    expect(parse(`sk-${'x'.repeat(600)}`).success).toBe(false);
  });
});
