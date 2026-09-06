import { Injectable, Logger } from '@nestjs/common';

import { DOMAINS } from '../../path/domain.schema';
import { DomainWindowLoader, type LoadedWindows } from './domain-window.loader';
import { computeMomentum, type Domain, type MomentumResult } from './momentum-engine';

// =============================================================================
// The engine, wired (issue #98, epic E11)
// =============================================================================
//
// Load once, compute three times. `forUser` is what `GET /progress` renders;
// `summary` is the two-field slot `GET /today` carries so the day screen can
// say "Health: steady" without a second request.
//
// No cache. Momentum is recomputed per request because it is cheap (one query,
// three pure passes) and because a cached state that lags a completion by an
// hour is a screen that argues with the user about what they just did.
// =============================================================================

export interface MomentumSummary {
  state: MomentumResult['state'];
  /** The first evidence bullet, or null when there is nothing to say. */
  headline: string | null;
}

@Injectable()
export class MomentumService {
  private readonly logger = new Logger(MomentumService.name);

  constructor(private readonly loader: DomainWindowLoader) {}

  /** Everything the Progress screen needs, plus the loaded rows for reuse. */
  async load(userId: string, now: Date = new Date()): Promise<LoadedWindows> {
    return this.loader.load(userId, now);
  }

  compute(loaded: LoadedWindows): Record<Domain, MomentumResult> {
    const started = Date.now();

    const result = Object.fromEntries(
      DOMAINS.map((domain) => [domain, computeMomentum(loaded.windows[domain as Domain])]),
    ) as Record<Domain, MomentumResult>;

    this.logger.debug(`progress.compute latencyMs=${Date.now() - started}`);
    return result;
  }

  async forUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<Record<Domain, MomentumResult>> {
    return this.compute(await this.loader.load(userId, now));
  }

  /**
   * The Today slot.
   *
   * A state word and one sentence — never the signals. Today is a screen about
   * the next hour; the place to read the whole window is `/progress`.
   */
  async summary(
    userId: string,
    now: Date = new Date(),
  ): Promise<Record<Domain, MomentumSummary>> {
    const momentum = await this.forUser(userId, now);

    return Object.fromEntries(
      DOMAINS.map((domain) => [
        domain,
        {
          state: momentum[domain as Domain].state,
          headline: momentum[domain as Domain].evidence[0] ?? null,
        },
      ]),
    ) as Record<Domain, MomentumSummary>;
  }
}
