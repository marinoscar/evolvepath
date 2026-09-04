import { mapOpenAiFailure, mapOpenAiThrow } from './openai-error';
import { MAX_AI_ERROR_MESSAGE_LENGTH } from '../../gateway/ai-key-redactor';

const noHeaders = new Headers();

describe('mapOpenAiFailure', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'no_model'],
    [429, 'rate_limit'],
    [500, 'provider'],
    [503, 'provider'],
    [400, 'provider'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(mapOpenAiFailure(status, null, noHeaders).code).toBe(code);
  });

  it('maps model_not_found by body code whatever the status', () => {
    expect(
      mapOpenAiFailure(
        400,
        { error: { message: 'no such model', code: 'model_not_found' } },
        noHeaders,
      ).code,
    ).toBe('no_model');
  });

  it('uses the provider message and captures x-request-id', () => {
    const headers = new Headers({ 'x-request-id': 'req_123' });

    const error = mapOpenAiFailure(
      429,
      { error: { message: 'Rate limit reached for gpt-5.4' } },
      headers,
    );

    expect(error.message).toBe('Rate limit reached for gpt-5.4');
    expect(error.status).toBe(429);
    expect(error.providerRequestId).toBe('req_123');
  });

  it('falls back to a status message when the body is not JSON', () => {
    expect(mapOpenAiFailure(502, null, noHeaders).message).toBe(
      'OpenAI request failed with HTTP 502',
    );
  });

  it('never lets the submitted key through', () => {
    const key = 'sk-live-abcdefghijklmnop';

    const error = mapOpenAiFailure(
      401,
      { error: { message: `Incorrect API key provided: ${key}` } },
      noHeaders,
      key,
    );

    expect(error.message).not.toContain(key);
    expect(error.message).toContain('[redacted]');
  });

  it('scrubs an sk- pattern even when it is not the key we hold', () => {
    const error = mapOpenAiFailure(
      401,
      { error: { message: 'Incorrect API key provided: sk-someoneelses123456' } },
      noHeaders,
      'sk-ours-abcdefghijkl',
    );

    expect(error.message).toBe('Incorrect API key provided: sk-***');
  });

  it('caps the message at 2000 characters', () => {
    const error = mapOpenAiFailure(
      500,
      { error: { message: 'y'.repeat(9000) } },
      noHeaders,
    );

    expect(error.message.length).toBe(MAX_AI_ERROR_MESSAGE_LENGTH);
  });
});

describe('mapOpenAiThrow', () => {
  it('maps an abort to timeout and states the deadline', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });

    const error = mapOpenAiThrow(abort, 'sk-x', 100);

    expect(error.code).toBe('timeout');
    expect(error.message).toBe('OpenAI request timed out after 100 ms');
  });

  it('maps a fetch TypeError to network', () => {
    const error = mapOpenAiThrow(new TypeError('fetch failed'), 'sk-x');

    expect(error.code).toBe('network');
    expect(error.message).toContain('Could not reach OpenAI');
  });

  it('maps anything else to provider, redacted', () => {
    const error = mapOpenAiThrow(
      new Error('boom with sk-abcdefghijklmnop'),
      'sk-abcdefghijklmnop',
    );

    expect(error.code).toBe('provider');
    expect(error.message).toBe('boom with [redacted]');
  });
});
