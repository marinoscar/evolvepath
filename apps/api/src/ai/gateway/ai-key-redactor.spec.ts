import {
  AiKeyRedactor,
  MAX_AI_ERROR_MESSAGE_LENGTH,
  redactAiText,
} from './ai-key-redactor';

describe('AiKeyRedactor', () => {
  it('replaces the exact registered secret', () => {
    const redactor = new AiKeyRedactor();
    redactor.protect('super-secret-value');

    expect(redactor.apply('failed with super-secret-value')).toBe(
      'failed with [redacted]',
    );
  });

  it('scrubs a key-shaped string it was never given', () => {
    // The pass that matters: OpenAI quotes a masked form of the submitted key
    // in its own 401 body, and a proxy could quote a key we never held.
    const redactor = new AiKeyRedactor();

    expect(
      redactor.apply('Incorrect API key provided: sk-abcdefghijklmnop.'),
    ).toBe('Incorrect API key provided: sk-***.');
  });

  it('leaves a short sk- fragment alone rather than eating prose', () => {
    const redactor = new AiKeyRedactor();
    expect(redactor.apply('the sk- prefix is required')).toBe(
      'the sk- prefix is required',
    );
  });

  it('withholds the whole message for a secret too short to replace safely', () => {
    // Inherited from SecretRedactor: an unreadable error is a bad outcome, a
    // leaked credential is worse.
    const redactor = new AiKeyRedactor();
    redactor.protect('ab');

    expect(redactor.apply('rejected ab')).toBe(
      '[error withheld: it contained the configured credential]',
    );
  });

  it('caps a long message, after scrubbing rather than before', () => {
    const redactor = new AiKeyRedactor();
    const key = 'sk-abcdefghijklmnopqrstuvwxyz';
    // The key sits past the cap, so a cap-first implementation would drop it
    // entirely; put another one before the cap so the assertion is real.
    const message = `${key} ${'x'.repeat(5000)} ${key}`;

    const out = redactor.apply(message);

    expect(out.length).toBe(MAX_AI_ERROR_MESSAGE_LENGTH);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('sk-abcdefghij');
    expect(out.startsWith('sk-*** ')).toBe(true);
  });

  it('redactAiText applies both passes in one shot', () => {
    expect(
      redactAiText('rejected sk-abcdefghijklmnop for account acct-1', [
        'acct-1',
      ]),
    ).toBe('rejected sk-*** for account [redacted]');
  });
});
