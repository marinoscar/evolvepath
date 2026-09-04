import { AiAdminTestService } from './ai-admin-test.service';
import { AiProviderError } from './gateway/ai-errors';
import { DEFAULT_AI_SETTINGS } from './ai-settings.schema';
import {
  AI_PLATFORM_CREDENTIAL_NAME,
  AI_PLATFORM_CREDENTIAL_PURPOSE,
} from './ai-credential.constants';

const actor = { id: 'user-1', email: 'admin@example.test' };

describe('AiAdminTestService', () => {
  const configured = {
    ...DEFAULT_AI_SETTINGS,
    provider: 'openai' as const,
    enabled: true,
    defaultModel: 'gpt-5.4',
  };

  let prisma: {
    aiInvocation: { create: jest.Mock };
    auditEvent: { create: jest.Mock };
  };
  let settings: { get: jest.Mock; resolveBaseUrl: jest.Mock };
  let credentials: { getSecret: jest.Mock };
  let provider: { listModels: jest.Mock; generate: jest.Mock };
  let service: AiAdminTestService;

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

  beforeEach(() => {
    prisma = {
      aiInvocation: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    settings = {
      get: jest.fn().mockResolvedValue(configured),
      resolveBaseUrl: jest.fn().mockReturnValue('https://api.openai.com/v1'),
    };
    credentials = { getSecret: jest.fn().mockResolvedValue('sk-platform-0000') };
    provider = {
      listModels: jest.fn().mockResolvedValue([{ id: 'gpt-5.4', created: 1 }]),
      generate: jest.fn().mockResolvedValue(okGeneration()),
    };

    service = new AiAdminTestService(
      prisma as never,
      settings as never,
      credentials as never,
      { get: () => provider } as never,
      { get: () => 60000 } as never,
    );
  });

  it('passes both checks and records a platform-scoped invocation', async () => {
    const result = await service.testConnection(actor);

    expect(result.success).toBe(true);
    expect(result.checks).toEqual({ listModels: 'passed', generate: 'passed' });
    expect(result.providerKind).toBe('openai');
    expect(result.model).toBe('gpt-5.4');
    expect(result.error).toBeNull();

    const row = prisma.aiInvocation.create.mock.calls[0]![0].data;
    expect(row.operation).toBe('test_connection');
    expect(row.keyScope).toBe('platform');
    expect(row.userId).toBe(actor.id);
    expect(row.status).toBe('succeeded');
    expect(row.model).toBe('gpt-5.4');
    expect(row.inputTokens).toBe(42);
  });

  it('sends a 16-token probe with the fixed instructions', async () => {
    await service.testConnection(actor);

    const [auth, request] = provider.generate.mock.calls[0]!;
    expect(auth).toEqual({
      apiKey: 'sk-platform-0000',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(request.model).toBe('gpt-5.4');
    expect(request.maxOutputTokens).toBe(16);
    expect(request.instructions).toBe('Reply with the JSON {"ok":true}.');
    expect(request.jsonSchema.name).toBe('connection_probe');
    expect(request.metadata).toEqual({ purpose: 'test_connection' });
  });

  it('uses the platform key and never a user key', async () => {
    await service.testConnection(actor);

    expect(credentials.getSecret).toHaveBeenCalledTimes(1);
    expect(credentials.getSecret).toHaveBeenCalledWith(
      AI_PLATFORM_CREDENTIAL_PURPOSE,
      AI_PLATFORM_CREDENTIAL_NAME,
    );
  });

  it('skips the generate probe when no default model is configured', async () => {
    settings.get.mockResolvedValue({ ...configured, defaultModel: null });

    const result = await service.testConnection(actor);

    // Skipped is not failed: there is simply nothing to generate against.
    expect(result.success).toBe(true);
    expect(result.checks).toEqual({ listModels: 'passed', generate: 'skipped' });
    expect(result.model).toBeNull();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(prisma.aiInvocation.create.mock.calls[0]![0].data.model).toBeNull();
  });

  it.each([
    [
      'no provider selected',
      { ...DEFAULT_AI_SETTINGS },
      /No AI provider is selected/,
    ],
    [
      'AI switched off',
      { ...configured, enabled: false },
      /AI is switched off/,
    ],
  ])('refuses as a result when %s', async (_label, stored, message) => {
    settings.get.mockResolvedValue(stored);

    const result = await service.testConnection(actor);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(message);
    expect(result.checks).toEqual({
      listModels: 'skipped',
      generate: 'skipped',
    });
    // Still recorded: "the admin pressed Test and nothing happened" is exactly
    // what the audit trail is for.
    expect(prisma.aiInvocation.create).toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalled();
  });

  it('refuses as a result when no platform key is stored', async () => {
    credentials.getSecret.mockResolvedValue(null);

    const result = await service.testConnection(actor);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No platform API key/);
    expect(provider.listModels).not.toHaveBeenCalled();
  });

  it('refuses as a result when the stored settings will not parse', async () => {
    settings.get.mockRejectedValue(new Error('Stored AI settings are invalid'));

    const result = await service.testConnection(actor);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be read/);
  });

  it("surfaces the provider's verbatim error and records a failure", async () => {
    provider.listModels.mockRejectedValue(
      new AiProviderError('auth', 'Incorrect API key provided: sk-***', 401),
    );

    const result = await service.testConnection(actor);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Incorrect API key provided: sk-***');
    expect(result.checks).toEqual({ listModels: 'failed', generate: 'skipped' });

    const row = prisma.aiInvocation.create.mock.calls[0]![0].data;
    expect(row.status).toBe('failed');
    expect(row.errorCode).toBe('auth');
  });

  it('reports a model that answers with the wrong shape as a failed generate', async () => {
    provider.generate.mockResolvedValue({
      ...okGeneration(),
      outputText: 'not json {',
    });

    const result = await service.testConnection(actor);

    expect(result.success).toBe(false);
    expect(result.checks.listModels).toBe('passed');
    expect(result.checks.generate).toBe('failed');
    expect(result.error).toMatch(/not with the expected JSON/);
  });

  it('reports a refusal distinctly', async () => {
    provider.generate.mockResolvedValue({
      ...okGeneration(),
      outputText: null,
      refusal: "I can't help with that.",
    });

    const result = await service.testConnection(actor);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/refused the probe/);
  });

  it('still answers when the telemetry write fails', async () => {
    // A database hiccup must not turn a successful diagnosis into a 500 on the
    // page that was doing the diagnosing.
    prisma.aiInvocation.create.mockRejectedValue(new Error('db down'));

    await expect(service.testConnection(actor)).resolves.toMatchObject({
      success: true,
    });
  });

  it('audits the outcome without any key material', async () => {
    provider.listModels.mockRejectedValue(
      new AiProviderError('auth', 'Incorrect API key provided: sk-***', 401),
    );

    await service.testConnection(actor);

    const audit = prisma.auditEvent.create.mock.calls[0]![0].data;
    expect(audit.action).toBe('ai_settings:test');
    expect(audit.targetId).toBe('ai');
    expect(audit.meta.success).toBe(false);
    expect(JSON.stringify(audit.meta)).not.toContain('sk-platform-0000');
  });
});
