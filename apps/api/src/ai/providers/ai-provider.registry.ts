import { Injectable } from '@nestjs/common';

import type { AiProviderKind } from '../ai-settings.schema';
import type { AiProvider } from './ai-provider.interface';
import { OpenAiProvider } from './openai/openai.provider';

/**
 * Resolve a configured provider kind to its implementation (issue #23).
 *
 * The indirection exists so the settings row's `provider` value — a string off
 * a JSONB column — becomes an injected instance at exactly one place, rather
 * than every caller doing `if (kind === 'openai') this.openai`. When a second
 * provider lands, this constructor and the map below are the whole change.
 *
 * THROWS A PLAIN `Error`, NOT AN `AiProviderError`. An unknown kind cannot come
 * from a user or from OpenAI: `aiSettingsSchema` rejects anything outside
 * `AI_PROVIDER_KINDS` at parse time, so reaching this line means a provider was
 * added to the enum and not to the map. That is a programmer error, and
 * dressing it as a provider failure would send it down the "show the admin the
 * provider's message" path where it would read as a transient outage.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly providers: Record<AiProviderKind, AiProvider>;

  constructor(openai: OpenAiProvider) {
    this.providers = { openai };
  }

  get(kind: AiProviderKind): AiProvider {
    const provider = this.providers[kind];
    if (!provider) throw new Error(`Unknown AI provider: ${String(kind)}`);
    return provider;
  }
}
