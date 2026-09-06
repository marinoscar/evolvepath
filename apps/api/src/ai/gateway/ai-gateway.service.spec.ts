import { z } from 'zod';

import { AiGatewayService } from './ai-gateway.service';
import { AiProviderError } from './ai-errors';
import { DEFAULT_AI_SETTINGS } from '../ai-settings.schema';
import { AI_PLATFORM_CREDENTIAL_PURPOSE } from '../ai-credential.constants';
import type { AiInvokeRequest } from './ai-gateway.types';

const USER_ID = 'user-1';

const schema = z.object({ greeting: z.string() });

const baseRequest: AiInvokeRequest<{ greeting: string }> = {
  persona: 'coach',
  userId: USER_ID,
  promptVersion: 'coach.v1',
  instructions: 'Be brief.',
  input: 'hello',
  schema,
  schemaName: 'coach_reply',
};

function generation(overrides: Record<string, unknown> = {}) {
  return {
    outputText: '{"greeting":"hi"}',
    refusal: null,
    usage: {
      inputTokens: 42,
      outputTokens: 7,
      cachedInputTokens: 1,
      reasoningTokens: 2,
    },
    providerRequestId: 'req_1',
    responseModel: 'gpt-5.4',
    incompleteReason: null,
    ...overrides,
  };
}

describe('AiGatewayService', () => {
  const configured = {
    ...DEFAULT_AI_SETTINGS,
    provider: 'openai' as const,
    enabled: true,
    defaultModel: 'gpt-5.4',
  };

  let settings: { get: jest.Mock; resolveModel: jest.Mock; resolveBaseUrl: jest.Mock };
  let userAiKey: { getSecretForUser: jest.Mock };
  let credentials: { getSecret: jest.Mock };
  let provider: { generate: jest.Mock };
  let attachments: { resolve: jest.Mock };
  let log: { record: jest.Mock };
  let service: AiGatewayService;

  const recorded = () => log.record.mock.calls[0]![0];

  beforeEach(() => {
    settings = {
      get: jest.fn().mockResolvedValue(configured),
      resolveModel: jest.fn().mockReturnValue('gpt-5.4'),
      resolveBaseUrl: jest.fn().mockReturnValue('https://api.openai.com/v1'),
    };
    userAiKey = {
      getSecretForUser: jest.fn().mockResolvedValue('sk-user-abcdefghijkl'),
    };
    // A spy the platform-key assertion can watch. The gateway must never reach
    // for this at all.
    credentials = { getSecret: jest.fn() };
    provider = { generate: jest.fn().mockResolvedValue(generation()) };
    attachments = { resolve: jest.fn().mockResolvedValue([]) };
    log = { record: jest.fn().mockResolvedValue(undefined) };

    service = new AiGatewayService(
      settings as never,
      userAiKey as never,
      { get: () => provider } as never,
      attachments as never,
      log as never,
      { get: () => 60000 } as never,
    );
  });

  describe('the happy path', () => {
    it('returns validated, typed output', async () => {
      const result = await service.invoke(baseRequest);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.output).toEqual({ greeting: 'hi' });
      expect(result.model).toBe('gpt-5.4');
      expect(result.usage.inputTokens).toBe(42);
      expect(result.invocationId).toEqual(expect.any(String));
    });

    it('records one row carrying the prompt version, tokens and the input', async () => {
      const result = await service.invoke(baseRequest);

      expect(log.record).toHaveBeenCalledTimes(1);
      expect(recorded()).toMatchObject({
        invocationId: result.invocationId,
        operation: 'invoke',
        keyScope: 'user',
        userId: USER_ID,
        persona: 'coach',
        model: 'gpt-5.4',
        promptVersion: 'coach.v1',
        status: 'succeeded',
        outputValid: true,
        attachmentCount: 0,
        inputTokens: 42,
        cachedInputTokens: 1,
        reasoningTokens: 2,
      });
      expect(recorded().input).toEqual({
        instructions: 'Be brief.',
        input: 'hello',
        attachmentObjectIds: [],
        schemaName: 'coach_reply',
      });
      // The key is handed to the logger so an echoed copy cannot survive.
      expect(recorded().secrets).toEqual(['sk-user-abcdefghijkl']);
    });

    it('passes the invocation id, persona and prompt version as provider metadata', async () => {
      const result = await service.invoke(baseRequest);

      expect(provider.generate.mock.calls[0]![1].metadata).toEqual({
        invocationId: result.invocationId,
        persona: 'coach',
        promptVersion: 'coach.v1',
      });
    });

    it('defaults reasoning effort from the persona and lets a caller override it', async () => {
      // `coach` declares none; `planner` declares 'medium'.
      await service.invoke(baseRequest);
      expect(provider.generate.mock.calls[0]![1].reasoningEffort).toBeUndefined();

      await service.invoke({ ...baseRequest, persona: 'planner' });
      expect(provider.generate.mock.calls[1]![1].reasoningEffort).toBe('medium');

      await service.invoke({ ...baseRequest, persona: 'planner', reasoningEffort: 'high' });
      expect(provider.generate.mock.calls[2]![1].reasoningEffort).toBe('high');
    });

    it('reads only the caller key and never the platform credential', async () => {
      await service.invoke(baseRequest);

      expect(userAiKey.getSecretForUser).toHaveBeenCalledWith(USER_ID);
      expect(provider.generate.mock.calls[0]![0].apiKey).toBe(
        'sk-user-abcdefghijkl',
      );
      // There is deliberately no platform-key fallback: it would break cost
      // attribution and the promise the setup gate makes.
      expect(credentials.getSecret).not.toHaveBeenCalled();
      expect(
        JSON.stringify(settings.resolveModel.mock.calls),
      ).not.toContain(AI_PLATFORM_CREDENTIAL_PURPOSE);
    });
  });

  describe('short circuits', () => {
    async function expectFailure(code: string) {
      const result = await service.invoke(baseRequest);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe(code);
      // Exactly one row on every exit path.
      expect(log.record).toHaveBeenCalledTimes(1);
      expect(recorded().errorCode).toBe(code);
      expect(recorded().invocationId).toBe(result.invocationId);
      return result;
    }

    it('throws for an unknown persona — the one programmer error', async () => {
      await expect(
        service.invoke({ ...baseRequest, persona: 'nope' as never }),
      ).rejects.toThrow(/Unknown AI persona/);
      expect(log.record).not.toHaveBeenCalled();
    });

    it('reports ai_disabled when the settings row will not parse', async () => {
      settings.get.mockRejectedValue(new Error('invalid'));
      await expectFailure('ai_disabled');
      expect(provider.generate).not.toHaveBeenCalled();
    });

    it('reports ai_disabled when AI is switched off', async () => {
      settings.get.mockResolvedValue({ ...configured, enabled: false });
      await expectFailure('ai_disabled');
    });

    it('reports no_model when nothing is configured for the persona', async () => {
      settings.resolveModel.mockReturnValue(null);
      await expectFailure('no_model');
    });

    it('reports no_user_key when the caller has none', async () => {
      userAiKey.getSecretForUser.mockResolvedValue(null);
      const result = await expectFailure('no_user_key');
      // The model is known by this point, so it is recorded.
      expect(result.model).toBe('gpt-5.4');
    });

    it('refuses attachments for a non-vision persona before touching storage', async () => {
      const result = await service.invoke({
        ...baseRequest,
        attachments: [{ storageObjectId: 'obj-1' }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('attachment');
      expect(result.error.message).toContain('does not accept attachments');
      // A persona that cannot see is not billed for downloading images.
      expect(attachments.resolve).not.toHaveBeenCalled();
    });

    it('accepts attachments for the vision persona', async () => {
      attachments.resolve.mockResolvedValue([
        { type: 'image', mimeType: 'image/png', base64: 'QQ==' },
      ]);

      const result = await service.invoke({
        ...baseRequest,
        persona: 'media_analyst',
        attachments: [{ storageObjectId: 'obj-1' }],
      });

      expect(result.ok).toBe(true);
      expect(provider.generate.mock.calls[0]![1].input).toEqual([
        { type: 'text', text: 'hello' },
        { type: 'image', mimeType: 'image/png', base64: 'QQ==' },
      ]);
      expect(recorded().attachmentCount).toBe(1);
      expect(recorded().input.attachmentObjectIds).toEqual(['obj-1']);
    });

    it('surfaces a resolver failure as an attachment error', async () => {
      attachments.resolve.mockRejectedValue(
        new AiProviderError('attachment', 'Attachment obj-1 was not found.'),
      );

      const result = await service.invoke({
        ...baseRequest,
        persona: 'media_analyst',
        attachments: [{ storageObjectId: 'obj-1' }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toEqual({
        code: 'attachment',
        message: 'Attachment obj-1 was not found.',
      });
    });
  });

  describe('interpreting the answer', () => {
    it('maps a provider rate limit to ok:false with status failed', async () => {
      provider.generate.mockRejectedValue(
        new AiProviderError('rate_limit', 'Rate limit reached for gpt-5.4', 429),
      );

      const result = await service.invoke(baseRequest);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('rate_limit');
      expect(recorded().status).toBe('failed');
    });

    it('records a refusal as refused, keeping the model\'s own words', async () => {
      provider.generate.mockResolvedValue(
        generation({ outputText: null, refusal: "I can't help with that." }),
      );

      const result = await service.invoke(baseRequest);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('refusal');
      expect(recorded().status).toBe('refused');
      expect(recorded().output).toEqual({ refusal: "I can't help with that." });
    });

    it('records unparseable JSON as invalid_output with the raw text', async () => {
      provider.generate.mockResolvedValue(
        generation({ outputText: 'not json {' }),
      );

      const result = await service.invoke(baseRequest);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('schema');
      expect(recorded().status).toBe('invalid_output');
      expect(recorded().outputValid).toBe(false);
      expect(recorded().output).toEqual({ raw: 'not json {' });
    });

    it('names the failing paths but never the values on a contract mismatch', async () => {
      provider.generate.mockResolvedValue(
        generation({ outputText: '{"greeting":123}' }),
      );

      const result = await service.invoke(baseRequest);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('schema');
      expect(result.error.message).toContain('greeting');
      // Field paths only: model output is about a user's private context.
      expect(result.error.message).not.toContain('123');
    });

    it('treats an early stop as invalid_output and names the reason', async () => {
      provider.generate.mockResolvedValue(
        generation({ incompleteReason: 'max_output_tokens' }),
      );

      const result = await service.invoke(baseRequest);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.message).toContain('max_output_tokens');
      expect(recorded().status).toBe('invalid_output');
    });

    it('redacts the user key out of a provider message', async () => {
      provider.generate.mockRejectedValue(
        new AiProviderError(
          'provider',
          'upstream echoed sk-user-abcdefghijkl',
          500,
        ),
      );

      const result = await service.invoke(baseRequest);

      if (result.ok) throw new Error('unreachable');
      expect(result.error.message).not.toContain('sk-user-abcdefghijkl');
    });

    it('does not surface the text of an unexpected internal error', async () => {
      provider.generate.mockRejectedValue(new Error('secret internal detail'));

      const result = await service.invoke(baseRequest);

      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('provider');
      expect(result.error.message).toBe('The AI call failed unexpectedly.');
    });
  });

  it('still returns a result when the telemetry write rejects', async () => {
    // The logger swallows its own failures. This asserts the gateway does not
    // depend on that: its never-throw contract is its own promise, not one
    // borrowed from a class that might stop catching.
    log.record.mockRejectedValue(new Error('db down'));

    await expect(service.invoke(baseRequest)).resolves.toMatchObject({
      ok: true,
      output: { greeting: 'hi' },
    });
  });

  it('throws synchronously for a schema strict mode cannot express', async () => {
    // A programmer error at the call site, deliberately raised OUTSIDE the span
    // so it never reads as a provider failure.
    await expect(
      service.invoke({
        ...baseRequest,
        schema: z.object({ counts: z.record(z.string(), z.number()) }) as never,
      }),
    ).rejects.toThrow(/record/);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
