import { AiModelCatalogService } from './ai-model-catalog.service';
import { AiProviderError } from '../gateway/ai-errors';
import { DEFAULT_AI_SETTINGS } from '../ai-settings.schema';
import {
  AI_PLATFORM_CREDENTIAL_NAME,
  AI_PLATFORM_CREDENTIAL_PURPOSE,
} from '../ai-credential.constants';

describe('AiModelCatalogService', () => {
  const configured = {
    ...DEFAULT_AI_SETTINGS,
    provider: 'openai' as const,
    enabled: true,
  };

  let settings: { get: jest.Mock; resolveBaseUrl: jest.Mock };
  let credentials: { getSecret: jest.Mock };
  let provider: { listModels: jest.Mock };
  let providers: { get: jest.Mock };
  let service: AiModelCatalogService;

  beforeEach(() => {
    jest.useFakeTimers();

    settings = {
      get: jest.fn().mockResolvedValue(configured),
      resolveBaseUrl: jest.fn().mockReturnValue('https://api.openai.com/v1'),
    };
    credentials = { getSecret: jest.fn().mockResolvedValue('sk-platform-0000') };
    provider = {
      listModels: jest.fn().mockResolvedValue([
        { id: 'gpt-5.4', created: 1 },
        { id: 'gpt-5.3', created: 2 },
        { id: 'gpt-4o', created: 3 },
        { id: 'gpt-5.5-realtime', created: 4 },
        { id: 'gpt-5.4-mini', created: 5 },
      ]),
    };
    providers = { get: jest.fn().mockReturnValue(provider) };

    service = new AiModelCatalogService(
      settings as never,
      credentials as never,
      providers as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('filters to GPT >= 5.4 and sorts newest first', async () => {
    const result = await service.list();

    expect(result.success).toBe(true);
    expect(result.models.map((m) => m.id)).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
    expect(result.source).toBe('live');
    expect(result.error).toBeNull();
  });

  it('reads the platform key, never a user key', async () => {
    await service.list();

    expect(credentials.getSecret).toHaveBeenCalledWith(
      AI_PLATFORM_CREDENTIAL_PURPOSE,
      AI_PLATFORM_CREDENTIAL_NAME,
    );
  });

  it('serves the cache inside the TTL and refetches after it', async () => {
    await service.list();
    expect(provider.listModels).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(4 * 60 * 1000);
    const cached = await service.list();
    expect(provider.listModels).toHaveBeenCalledTimes(1);
    expect(cached.source).toBe('cache');

    jest.advanceTimersByTime(2 * 60 * 1000);
    const refetched = await service.list();
    expect(provider.listModels).toHaveBeenCalledTimes(2);
    expect(refetched.source).toBe('live');
  });

  it('bypasses the cache when asked to refresh', async () => {
    await service.list();
    await service.list({ refresh: true });

    expect(provider.listModels).toHaveBeenCalledTimes(2);
  });

  it('forgets the cache on invalidate, because a save can change the account', async () => {
    await service.list();
    service.invalidate();
    await service.list();

    expect(provider.listModels).toHaveBeenCalledTimes(2);
  });

  it('falls back to the cached list on a provider failure and says it is stale', async () => {
    await service.list();
    provider.listModels.mockRejectedValue(
      new AiProviderError('rate_limit', 'Rate limit reached'),
    );

    const result = await service.list({ refresh: true });

    expect(result.success).toBe(false);
    expect(result.source).toBe('cache');
    expect(result.models.map((m) => m.id)).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
    expect(result.error).toBe('Rate limit reached');
  });

  it('answers with an explanation and no cache on a cold provider failure', async () => {
    provider.listModels.mockRejectedValue(
      new AiProviderError('auth', 'Incorrect API key provided: sk-***'),
    );

    const result = await service.list();

    expect(result).toEqual({
      success: false,
      models: [],
      fetchedAt: null,
      source: null,
      error: 'Incorrect API key provided: sk-***',
    });
  });

  it('explains a missing platform key rather than calling the provider', async () => {
    credentials.getSecret.mockResolvedValue(null);

    const result = await service.list();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No platform API key/);
    expect(provider.listModels).not.toHaveBeenCalled();
  });

  it('explains a missing provider selection', async () => {
    settings.get.mockResolvedValue(DEFAULT_AI_SETTINGS);

    const result = await service.list();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No AI provider is selected/);
  });

  it('still lists models while AI is switched off', async () => {
    // Disabling AI stops calls on users' behalf; it must not stop an
    // administrator configuring which model would run when they switch it on.
    settings.get.mockResolvedValue({ ...configured, enabled: false });

    const result = await service.list();

    expect(result.success).toBe(true);
    expect(result.models).toHaveLength(2);
  });

  it('degrades an unreadable settings row to a sentence', async () => {
    settings.get.mockRejectedValue(new Error('Stored AI settings are invalid'));

    const result = await service.list();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be read/);
  });
});
