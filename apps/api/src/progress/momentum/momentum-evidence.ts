import type {
  Domain,
  MomentumSignals,
  MomentumState,
  WindowCommitment,
} from './momentum-engine';
import { HALF_WINDOW_DAYS, MIN_PLANNED } from './momentum-engine';

// =============================================================================
// The sentences under a momentum state (issue #98, epic E11)
// =============================================================================
//
// PRD §54 fixes the presentation: a state word plus evidence sentences, and
// explicitly forbids "Health Score: 77/100". So every bullet here is a COUNT —
// "5 of 6 planned workouts completed" — and there is no code path that can
// produce a percentage, because no template contains a `%` or a division.
//
// `momentum-engine.ts` imports `buildEvidence` and this file imports only TYPES
// back from it, so the arrow is erased at compile time.
// =============================================================================

const DAY_MS = 24 * 3_600_000;

/** At most three, so the card stays readable on a phone. */
export const MAX_EVIDENCE_BULLETS = 3;

/**
 * What the user calls the thing they planned.
 *
 * Only the specific noun when EVERY decided row agrees; a window holding one
 * workout and two other health commitments is "health commitments", because
 * "3 planned workouts" would be a false statement about what they intended.
 */
export function nounFor(domain: Domain, decided: WindowCommitment[], count: number): string {
  const all = (type: string) =>
    decided.length > 0 && decided.every((row) => row.commitmentType === type);

  if (domain === 'HEALTH') {
    if (all('workout')) return count === 1 ? 'workout' : 'workouts';
    return count === 1 ? 'health commitment' : 'health commitments';
  }
  if (domain === 'WORK') {
    if (all('focus_session')) return count === 1 ? 'focus session' : 'focus sessions';
    return count === 1 ? 'work action' : 'work actions';
  }
  return count === 1 ? 'family commitment' : 'family commitments';
}

function halves(decided: WindowCommitment[], now: Date) {
  const halfPoint = new Date(now.getTime() - HALF_WINDOW_DAYS * DAY_MS);
  const isSuccess = (row: WindowCommitment) =>
    row.status === 'COMPLETED' || row.status === 'PARTIALLY_COMPLETED';

  const recent = decided.filter((row) => row.scheduledStart >= halfPoint);
  const prior = decided.filter((row) => row.scheduledStart < halfPoint);

  return {
    recentPlanned: recent.length,
    recentSuccesses: recent.filter(isSuccess).length,
    priorPlanned: prior.length,
    priorSuccesses: prior.filter(isSuccess).length,
  };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The bullets, in priority order, capped at three.
 *
 * `INSUFFICIENT_DATA` returns exactly one and returns early: the other
 * templates all describe behaviour, and there is not enough of it yet to
 * describe without inventing a trend from two data points.
 */
export function buildEvidence(
  signals: MomentumSignals,
  domain: Domain,
  state: MomentumState,
  decided: WindowCommitment[],
  now: Date,
): string[] {
  if (state === 'INSUFFICIENT_DATA') {
    return [
      `Not enough planned ${nounFor(domain, decided, 2)} yet — momentum appears after ${MIN_PLANNED}`,
    ];
  }

  const successes = signals.completed + signals.partial;
  const bullets: string[] = [
    `${successes} of ${signals.planned} planned ${nounFor(domain, decided, signals.planned)} completed`,
  ];

  if (signals.returnedAfterIdleDays !== null) {
    const n = signals.returnedAfterIdleDays;
    bullets.push(`Returned ${n} ${plural(n, 'day', 'days')} after a miss`);
  }

  if (signals.consecutiveMisses >= 2) {
    bullets.push(`${signals.consecutiveMisses} in a row not started`);
  }

  if (signals.fallback > 0) {
    bullets.push(
      `${signals.fallback} completed with the short or minimum version`,
    );
  }

  if (signals.rescheduledTwice > 0) {
    bullets.push(`${signals.rescheduledTwice} moved more than once`);
  }

  if (
    signals.recentRatio !== null &&
    signals.priorRatio !== null &&
    (state === 'IMPROVING' || state === 'SLIPPING')
  ) {
    const h = halves(decided, now);
    bullets.push(
      `Last two weeks: ${h.recentSuccesses} of ${h.recentPlanned}, ` +
        `before that ${h.priorSuccesses} of ${h.priorPlanned}`,
    );
  }

  return bullets.slice(0, MAX_EVIDENCE_BULLETS);
}
