import type { ComebackState, ComebackTrigger } from '@prisma/client';

// =============================================================================
// Is this person coming back? (issue #112, epic E11)
// =============================================================================
//
// Pure, and with no clock of its own. PRD §57 gives the triggers; the value of
// writing them here rather than inside the sweep is that the answer can be
// pinned by a table instead of by a database.
//
// TWO RULES THAT LOOK LIKE DETAILS AND ARE NOT:
//
//   * A user with no history is never offered a comeback. There is nothing to
//     come back to, and "welcome back" to somebody who has not started yet is
//     the product telling them a story about themselves that is not true.
//   * An open offer suppresses everything. Offers never stack — PRD §56 asks
//     for ONE restart action, and a second sweep finding the same silence must
//     not turn one kind sentence into two.
// =============================================================================

/** Silence this long is an absence rather than a quiet week. */
export const INACTIVITY_DAYS = 3;
export const MISSES_WINDOW_DAYS = 7;
export const MISSES_THRESHOLD = 4;
/** Past this, the misses look like the plan rather than the week. */
export const PLAN_DRIFT_MISSES_14D = 4;
export const PLAN_DRIFT_CLOSED = 5;

const DAY_MS = 24 * 3_600_000;

export interface DetectorInput {
  now: Date;
  lastActiveAt: Date | null;
  /** Has this user ever done anything at all? */
  hasHistory: boolean;
  missedLast7: number;
  comebackState: ComebackState;
}

export function detectComeback(input: DetectorInput): ComebackTrigger | null {
  if (input.comebackState !== 'NONE') return null;
  if (!input.hasHistory) return null;

  const idle =
    input.lastActiveAt === null ||
    input.now.getTime() - input.lastActiveAt.getTime() >= INACTIVITY_DAYS * DAY_MS;

  if (idle) return 'INACTIVITY';
  if (input.missedLast7 >= MISSES_THRESHOLD) return 'REPEATED_MISSES';

  return null;
}

/** Whole days of silence, for the copy. Zero when the user was never idle. */
export function idleDaysOf(now: Date, lastActiveAt: Date | null): number {
  if (!lastActiveAt) return INACTIVITY_DAYS;
  return Math.max(0, Math.floor((now.getTime() - lastActiveAt.getTime()) / DAY_MS));
}

/**
 * Whether the misses look like plan drift rather than a bad week.
 *
 * A FLAG, never a plan change. PRD §15 means nothing in this module writes a
 * `PlanVersion`; the user is offered a link to the coach and decides.
 */
export function suggestsPlanReview(missedLast14: number, closedCount: number): boolean {
  return missedLast14 >= PLAN_DRIFT_MISSES_14D || closedCount >= PLAN_DRIFT_CLOSED;
}
