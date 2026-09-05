import { Injectable } from '@nestjs/common';

// =============================================================================
// TestThrottle (issue #24, epic #20)
// =============================================================================
//
// The "Test connection" and "Refresh models" buttons put a request on OpenAI's
// network under somebody's key, on a click. Without a bound, a stuck button, an
// impatient administrator or a script turns an admin page into a way to burn
// another party's rate limit and, for the generate probe, their money.
//
// -----------------------------------------------------------------------------
// PER PROCESS, AND THAT IS A DOCUMENTED LIMITATION, NOT AN OVERSIGHT
// -----------------------------------------------------------------------------
//
// The window lives in this object's memory. Two API replicas therefore allow
// twice the configured rate, and a restart forgets everything. That is
// acceptable for what this actually defends against — an accidental loop and a
// bored click — and it buys the epic a throttle with no Redis, no new
// dependency and no shared-state failure mode of its own.
//
// It is NOT a defence against a determined caller, and nothing else in this
// product should be built on it. `@nestjs/throttler` with a Redis store is the
// upgrade path when a real limit is needed; the buckets below are already named
// the way that migration would want them.
//
// NO TIMER. Old timestamps are pruned on the next call for the same key, so an
// idle process holds a bounded amount of memory (one array per key that was
// ever used) and nothing keeps the event loop alive.
// =============================================================================

/** Sliding window, in milliseconds. */
const WINDOW_MS = 60_000;

/**
 * How many attempts each surface allows per user per window.
 *
 * `models_refresh` is looser than the tests because it is cheap — a catalog
 * listing costs no tokens — and because an administrator legitimately refreshes
 * repeatedly while OpenAI propagates a new tier grant. The two `*_test` buckets
 * are tight because each one can spend tokens.
 */
export const THROTTLE_LIMITS = {
  user_test: 5,
  admin_test: 5,
  models_refresh: 10,
  /**
   * The family behaviour-rewrite suggestion (issue #41). Looser than the two
   * `*_test` buckets because it is typed into a form rather than clicked, and
   * the deterministic verdict the user actually needs never reaches this code
   * at all — only the optional rephrase does.
   */
  family_lint: 10,
} as const;

/** One rate-limited surface. */
export type ThrottleBucket = keyof typeof THROTTLE_LIMITS;

/** Allowed, or denied with the number of seconds to wait. */
export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

@Injectable()
export class TestThrottle {
  private readonly hits = new Map<string, number[]>();

  /**
   * Record an attempt and say whether it may proceed.
   *
   * NOT IDEMPOTENT — calling this is the attempt. Callers must call it once,
   * before doing the work, and must not call it again to "check" the result.
   */
  check(bucket: ThrottleBucket, userId: string): ThrottleDecision {
    const key = `${bucket}:${userId}`;
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    const recent = (this.hits.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= THROTTLE_LIMITS[bucket]) {
      this.hits.set(key, recent);

      // Time until the OLDEST hit in the window falls out of it — the moment a
      // slot actually frees. Rounded up and floored at 1, because a
      // `Retry-After: 0` invites an immediate retry that is denied again.
      const oldest = recent[0]!;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + WINDOW_MS - now) / 1000),
      );

      return { allowed: false, retryAfterSeconds };
    }

    recent.push(now);
    this.hits.set(key, recent);

    return { allowed: true };
  }
}
