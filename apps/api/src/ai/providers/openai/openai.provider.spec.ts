import { AiProviderError } from '../../gateway/ai-errors';
import type { AiGenerateRequest, AiProviderAuth } from '../ai-provider.interface';
import { OpenAiProvider } from './openai.provider';

const auth: AiProviderAuth = {
  apiKey: 'sk-test-abcdefghijklmnop',
  baseUrl: 'https://api.example.test/v1',
};

const baseRequest: AiGenerateRequest = {
  model: 'gpt-5.4',
  instructions: 'Reply with JSON.',
  input: [{ type: 'text', text: 'ping' }],
  jsonSchema: {
    name: 'connection_probe',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
  },
  timeoutMs: 5000,
};

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function completedResponse(text = '{"ok":true}'): unknown {
  return {
    id: 'resp_1',
    object: 'response',
    model: 'gpt-5.4-2026-03-01',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    ],
    usage: {
      input_tokens: 42,
      output_tokens: 7,
      input_tokens_details: { cached_tokens: 12 },
      output_tokens_details: { reasoning_tokens: 3 },
    },
    incomplete_details: null,
  };
}

describe('OpenAiProvider', () => {
  let provider: OpenAiProvider;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    provider = new OpenAiProvider();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  /** The body of the single fetch call made by the test. */
  function sentBody(): Record<string, any> {
    return JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body));
  }

  describe('generate', () => {
    it('sends a strict json_schema request with store: false', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(completedResponse()));

      await provider.generate(auth, baseRequest);

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.example.test/v1/responses');
      expect(init.method).toBe('POST');

      const body = sentBody();
      // store: false is mandatory — this product sends a user's own coaching
      // context under their own key and must not leave it in OpenAI's store.
      expect(body.store).toBe(false);
      expect(body.model).toBe('gpt-5.4');
      expect(body.instructions).toBe('Reply with JSON.');
      expect(body.input[0].role).toBe('user');
      expect(body.input[0].content).toEqual([
        { type: 'input_text', text: 'ping' },
      ]);
      expect(body.text.format).toEqual({
        type: 'json_schema',
        name: 'connection_probe',
        schema: baseRequest.jsonSchema.schema,
        strict: true,
      });
    });

    it('tolerates a base URL with a trailing slash', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(completedResponse()));

      await provider.generate(
        { ...auth, baseUrl: 'https://api.example.test/v1/' },
        baseRequest,
      );

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        'https://api.example.test/v1/responses',
      );
    });

    it('sends an image part as an input_image data URL with its detail', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(completedResponse()));

      await provider.generate(auth, {
        ...baseRequest,
        input: [
          { type: 'text', text: 'what is this?' },
          {
            type: 'image',
            mimeType: 'image/jpeg',
            base64: 'QUJD',
            detail: 'high',
          },
        ],
      });

      expect(sentBody().input[0].content[1]).toEqual({
        type: 'input_image',
        image_url: 'data:image/jpeg;base64,QUJD',
        detail: 'high',
      });
    });

    it('defaults image detail to auto', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(completedResponse()));

      await provider.generate(auth, {
        ...baseRequest,
        input: [{ type: 'image', mimeType: 'image/png', base64: 'QQ==' }],
      });

      expect(sentBody().input[0].content[0].detail).toBe('auto');
    });

    it('omits reasoning, max_output_tokens and metadata when not asked for', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(completedResponse()));

      await provider.generate(auth, baseRequest);

      const body = sentBody();
      expect('reasoning' in body).toBe(false);
      expect('max_output_tokens' in body).toBe(false);
      expect('metadata' in body).toBe(false);
    });

    it('sends reasoning effort, token cap and metadata when given', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(completedResponse()));

      await provider.generate(auth, {
        ...baseRequest,
        reasoningEffort: 'medium',
        maxOutputTokens: 16,
        metadata: { invocationId: 'abc', persona: 'coach' },
      });

      const body = sentBody();
      expect(body.reasoning).toEqual({ effort: 'medium' });
      expect(body.max_output_tokens).toBe(16);
      expect(body.metadata).toEqual({ invocationId: 'abc', persona: 'coach' });
    });

    it('carries the key in the Authorization header and nowhere else', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(completedResponse()));

      await provider.generate(auth, baseRequest);

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(init.headers.Authorization).toBe(`Bearer ${auth.apiKey}`);
      expect(init.headers['User-Agent']).toBe('evolvepath-api');
      expect(String(url)).not.toContain(auth.apiKey);
      expect(String(init.body)).not.toContain(auth.apiKey);
    });

    it('maps usage, response model and the provider request id', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(completedResponse(), {
          headers: { 'x-request-id': 'req_abc' },
        }),
      );

      const result = await provider.generate(auth, baseRequest);

      expect(result.outputText).toBe('{"ok":true}');
      expect(result.refusal).toBeNull();
      expect(result.usage).toEqual({
        inputTokens: 42,
        outputTokens: 7,
        cachedInputTokens: 12,
        reasoningTokens: 3,
      });
      expect(result.responseModel).toBe('gpt-5.4-2026-03-01');
      expect(result.providerRequestId).toBe('req_abc');
      expect(result.incompleteReason).toBeNull();
    });

    it('reports a refusal with no output text', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({
          ...(completedResponse() as Record<string, unknown>),
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'refusal', refusal: "I can't help with that." }],
            },
          ],
        }),
      );

      const result = await provider.generate(auth, baseRequest);

      expect(result.refusal).toBe("I can't help with that.");
      expect(result.outputText).toBeNull();
    });

    it('surfaces incomplete_details.reason', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({
          ...(completedResponse() as Record<string, unknown>),
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      );

      expect((await provider.generate(auth, baseRequest)).incompleteReason).toBe(
        'max_output_tokens',
      );
    });

    it('skips reasoning items in output[] rather than reading them', async () => {
      // PRD §16/§88: chain of thought is never lifted out of the payload.
      fetchSpy.mockResolvedValue(
        jsonResponse({
          ...(completedResponse() as Record<string, unknown>),
          output: [
            { type: 'reasoning', summary: ['secret thoughts'] },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: '{"ok":true}' }],
            },
          ],
        }),
      );

      const result = await provider.generate(auth, baseRequest);

      expect(result.outputText).toBe('{"ok":true}');
      expect(JSON.stringify(result)).not.toContain('secret thoughts');
    });

    it.each([
      [401, 'auth'],
      [404, 'no_model'],
      [429, 'rate_limit'],
      [503, 'provider'],
    ])('turns HTTP %i into AiProviderError code %s', async (status, code) => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ error: { message: 'nope' } }, { status }),
      );

      await expect(provider.generate(auth, baseRequest)).rejects.toMatchObject({
        code,
      });
    });

    it('never puts the key in the error message', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(
          { error: { message: `Incorrect API key provided: ${auth.apiKey}` } },
          { status: 401 },
        ),
      );

      const error = await provider
        .generate(auth, baseRequest)
        .catch((err: AiProviderError) => err);

      expect(error).toBeInstanceOf(AiProviderError);
      expect((error as AiProviderError).message).not.toContain(auth.apiKey);
    });

    it('maps a fetch network failure to network', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

      await expect(provider.generate(auth, baseRequest)).rejects.toMatchObject({
        code: 'network',
      });
    });

    it('aborts and reports timeout when the deadline elapses', async () => {
      // A fetch that only settles when the provider's own AbortController
      // fires, which is what proves the signal is wired rather than ignored.
      fetchSpy.mockImplementation(
        (_url: unknown, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              );
            });
          }),
      );

      const started = Date.now();
      const error = await provider
        .generate(auth, { ...baseRequest, timeoutMs: 20 })
        .catch((err: AiProviderError) => err);

      expect((error as AiProviderError).code).toBe('timeout');
      expect((error as AiProviderError).message).toContain('20 ms');
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('rejects an unreadable 2xx body', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html>not json</html>', { status: 200 }),
      );

      await expect(provider.generate(auth, baseRequest)).rejects.toMatchObject({
        code: 'provider',
        message: 'OpenAI returned an unreadable response',
      });
    });

    it('defaults missing usage counters to zero rather than throwing', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({
          model: 'gpt-5.4',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"ok":true}' }],
            },
          ],
        }),
      );

      expect((await provider.generate(auth, baseRequest)).usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      });
    });
  });

  describe('listModels', () => {
    it('returns every id the key can reach, unfiltered', async () => {
      // Filtering is the catalog service's job, so the >= 5.4 rule lives in
      // exactly one place.
      fetchSpy.mockResolvedValue(
        jsonResponse({
          object: 'list',
          data: [
            { id: 'gpt-5.4', created: 1 },
            { id: 'gpt-4o', created: 2 },
            { id: 'gpt-5.5-realtime', created: 3 },
          ],
        }),
      );

      const models = await provider.listModels(auth);

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        'https://api.example.test/v1/models',
      );
      expect(models.map((m) => m.id)).toEqual([
        'gpt-5.4',
        'gpt-4o',
        'gpt-5.5-realtime',
      ]);
    });

    it('maps a 401 to auth', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(
          { error: { message: 'Incorrect API key provided: sk-***' } },
          { status: 401 },
        ),
      );

      await expect(provider.listModels(auth)).rejects.toMatchObject({
        code: 'auth',
      });
    });

    it('rejects an unreadable catalog', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ object: 'list' }));

      await expect(provider.listModels(auth)).rejects.toMatchObject({
        code: 'provider',
      });
    });
  });
});
