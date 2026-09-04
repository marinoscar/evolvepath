import { Injectable, Logger } from '@nestjs/common';

import { CredentialsService } from '../../credentials/credentials.service';
import {
  AI_PLATFORM_CREDENTIAL_NAME,
  AI_PLATFORM_CREDENTIAL_PURPOSE,
} from '../ai-credential.constants';
import { AiSettingsService } from '../ai-settings.service';
import { AiProviderError } from '../gateway/ai-errors';
import type { AiModelInfo } from '../providers/ai-provider.interface';
import { AiProviderRegistry } from '../providers/ai-provider.registry';
import { filterSupportedModels } from './model-version-filter';

// =============================================================================
// AiModelCatalogService (issue #24, epic #20)
// =============================================================================
//
// "Which models can this platform key actually reach?" — asked by the admin
// page on every load and on every click of Refresh models.
//
// -----------------------------------------------------------------------------
// IN MEMORY, WITH A SHORT TTL, AND NOT IN THE SETTINGS ROW
// -----------------------------------------------------------------------------
//
// Storing the catalog in the `'ai'` `system_settings` row was the obvious
// alternative and is wrong for a mechanical reason: that row carries the
// `version` counter the admin form uses for `If-Match`. A background catalog
// write would bump it, and the administrator's next save would 409 against a
// change they never made and cannot see. The cache is derived data with a
// provider as its source of truth; it does not belong in a versioned document.
//
// Five minutes is short enough that a newly granted model tier appears without
// anyone thinking about it, and long enough that opening the settings page
// three times does not make three network calls. `refresh: true` bypasses it
// entirely, which is what the button is for — and is why that path is
// throttled separately.
//
// -----------------------------------------------------------------------------
// IT NEVER THROWS
// -----------------------------------------------------------------------------
//
// Every failure comes back as `{ success: false, error }`, including "no key
// configured" and "no provider chosen", because to the administrator those are
// the same question — "why is this list empty?" — and answering half of them
// through the error envelope means the page needs two code paths for one
// sentence. On a provider failure with a warm cache the previous list is
// returned with `source: 'cache'`, so the page can keep working while saying
// plainly that it is showing stale data.
// =============================================================================

/** Five minutes. See the header for why this number and not a longer one. */
const CATALOG_TTL_MS = 5 * 60 * 1000;

export interface AiModelsResult {
  success: boolean;
  models: AiModelInfo[];
  fetchedAt: Date | null;
  source: 'live' | 'cache' | null;
  error: string | null;
}

@Injectable()
export class AiModelCatalogService {
  private readonly logger = new Logger(AiModelCatalogService.name);

  private cached: { models: AiModelInfo[]; fetchedAt: number } | null = null;

  constructor(
    private readonly settings: AiSettingsService,
    private readonly credentials: CredentialsService,
    private readonly providers: AiProviderRegistry,
  ) {}

  /**
   * The supported catalog, from cache or from the provider.
   *
   * @param refresh bypass the TTL. The Refresh models button; throttled by the
   *                controller, not here, because a throttle needs the caller's
   *                identity and this service has no request scope.
   */
  async list({ refresh = false } = {}): Promise<AiModelsResult> {
    const fresh =
      this.cached && Date.now() - this.cached.fetchedAt < CATALOG_TTL_MS;

    if (!refresh && fresh) {
      return {
        success: true,
        models: this.cached!.models,
        fetchedAt: new Date(this.cached!.fetchedAt),
        source: 'cache',
        error: null,
      };
    }

    let providerKind: 'openai' | null = null;

    try {
      const settings = await this.settings.get();

      if (settings.provider === null) {
        return this.failure(
          'No AI provider is selected. Choose OpenAI and save, then refresh.',
        );
      }

      providerKind = settings.provider;

      // NOTE: a DISABLED provider still lists models. Disabling AI stops the
      // product making calls on users' behalf; it does not stop an
      // administrator from configuring which model would be used when they
      // switch it back on. Refusing here would make the page unusable in
      // exactly the state an administrator is most likely to be repairing it.
      const apiKey = await this.credentials.getSecret(
        AI_PLATFORM_CREDENTIAL_PURPOSE,
        AI_PLATFORM_CREDENTIAL_NAME,
      );

      if (!apiKey) {
        return this.failure(
          'No platform API key is configured. Save one, then refresh.',
        );
      }

      const models = await this.providers
        .get(providerKind)
        .listModels({ apiKey, baseUrl: this.settings.resolveBaseUrl(settings) });

      const supported = filterSupportedModels(models);
      const fetchedAt = Date.now();
      this.cached = { models: supported, fetchedAt };

      return {
        success: true,
        models: supported,
        fetchedAt: new Date(fetchedAt),
        source: 'live',
        error: null,
      };
    } catch (err) {
      const message =
        err instanceof AiProviderError
          ? err.message
          : // A non-provider failure here is an unreadable settings row or a
            // programmer error. The administrator still gets a sentence rather
            // than an empty select with no explanation.
            'The model catalog could not be read. Check the AI settings and try again.';

      this.logger.warn(
        `AI model catalog fetch failed: ${err instanceof AiProviderError ? err.code : 'settings'}`,
      );

      return this.failure(message);
    }
  }

  /**
   * Forget the cached catalog.
   *
   * Called on every settings save, because a save can change the key or the
   * base URL — after which the cached list describes a different account.
   */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * A failure that still shows the last known list when there is one.
   *
   * `source: 'cache'` with `success: false` is the honest combination: the page
   * has models to render and must say they are stale rather than presenting
   * them as live.
   */
  private failure(error: string): AiModelsResult {
    return {
      success: false,
      models: this.cached?.models ?? [],
      fetchedAt: this.cached ? new Date(this.cached.fetchedAt) : null,
      source: this.cached ? 'cache' : null,
      error,
    };
  }
}
