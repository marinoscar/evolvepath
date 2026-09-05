import { Injectable } from '@nestjs/common';

import type { TodayInsight } from '../today.schema';

// =============================================================================
// The insight cache (issues #38 and #43, epic E05)
// =============================================================================
//
// ITS OWN PROVIDER, DEPENDING ON NOTHING, and that is what it is for. The check-in
// (#43) must invalidate the cached sentence, and the insight service (#38) reads
// the day it needs from `TodayService`. Putting the cache inside the insight
// service would make `CheckInService → TodayInsightService → TodayService →
// CandidateLoaderService → CHECK_IN_READER → CheckInService` a real dependency
// cycle. Depending on a store instead of on a service is how that stops being a
// cycle without a `forwardRef` nobody can reason about later.
//
// PER-PROCESS, deliberately, and documented as such: with several API instances a
// user can see one regeneration per instance per day. A shared cache is real
// infrastructure for a sentence whose only cost is one small model call, and it
// would need this same invalidation anyway.
// =============================================================================

interface CacheEntry {
  dateLocal: string;
  insight: TodayInsight;
}

@Injectable()
export class TodayInsightCache {
  /** One entry per user. The stored date is what evicts it. */
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * The sentence generated for this user on this local date, or null.
   *
   * The date not matching IS the eviction: no timer, no sweep, and it lands at
   * the user's local midnight rather than the server's.
   */
  get(userId: string, dateLocal: string): TodayInsight | null {
    const entry = this.entries.get(userId);

    return entry && entry.dateLocal === dateLocal ? entry.insight : null;
  }

  set(userId: string, dateLocal: string, insight: TodayInsight): void {
    this.entries.set(userId, { dateLocal, insight });
  }

  /** Called by the check-in: a stale sentence reads as "nothing listened". */
  invalidate(userId: string): void {
    this.entries.delete(userId);
  }
}
