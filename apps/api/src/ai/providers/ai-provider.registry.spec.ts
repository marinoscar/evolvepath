import { AiProviderRegistry } from './ai-provider.registry';
import { OpenAiProvider } from './openai/openai.provider';

describe('AiProviderRegistry', () => {
  const openai = new OpenAiProvider();
  const registry = new AiProviderRegistry(openai);

  it('resolves the configured kind to its implementation', () => {
    expect(registry.get('openai')).toBe(openai);
  });

  it('throws a plain Error for a kind with no implementation', () => {
    // Reaching this means the enum grew and the map did not — a programmer
    // error, deliberately not an AiProviderError.
    expect(() =>
      registry.get('anthropic' as unknown as 'openai'),
    ).toThrow('Unknown AI provider');
  });
});
