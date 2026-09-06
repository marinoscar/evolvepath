import type { CommitmentStatus } from '@prisma/client';

import { buildEvidence } from './momentum-evidence';

// =============================================================================
// The momentum engine (issue #98, epic E11)
// =============================================================================
//
// PRD §52-§54 and VISION §30-§31. A single "quality of life score" is replaced
// by six per-domain STATES, each justified by sentences made of counts.
//
// NOTHING IN THIS FILE DOES I/O. No Nest, no Prisma client, no `Date.now()`.
// PRD §53 asks for a formula that is "deterministic and testable", and the only
// way to be sure of that is for the function to have no way of reading anything
// the caller did not hand it. `now` arrives on the input for the same reason.
//
// There is no number here that scores the person. `ratio` exists inside the
// signals because the rules compare trends, and it is deliberately NOT
// serialised by `progress.schema.ts` — a ratio on the wire is one pull request
// away from a percentage badge, which is exactly what PRD P13 forbids.
// =============================================================================

export type Domain = 'WORK' | 'FAMILY' | 'HEALTH';

export type MomentumState =
  | 'BUILDING'
  | 'IMPROVING'
  | 'STEADY'
  | 'SLIPPING'
  | 'RECOVERING'
  | 'INSUFFICIENT_DATA';

export const MOMENTUM_STATES: readonly MomentumState[] = [
  'BUILDING',
  'IMPROVING',
  'STEADY',
  'SLIPPING',
  'RECOVERING',
  'INSUFFICIENT_DATA',
] as const;

/** The whole window momentum is computed over. */
export const WINDOW_DAYS = 28;
/** Split point for the trend comparison. */
export const HALF_WINDOW_DAYS = 14;
/** Below this many decided rows there is nothing honest to say. */
export const MIN_PLANNED = 3;
/** A user younger than this is still BUILDING rather than STEADY. */
export const BUILDING_MAX_HISTORY_DAYS = 14;
export const BUILDING_MIN_RATIO = 0.5;
/** How far the two halves must diverge before it is a trend and not noise. */
export const TREND_DELTA = 0.15;
export const SLIP_CONSECUTIVE_MISSES = 3;
/** A gap shorter than this is a normal week, not an absence. */
export const RECOVERY_IDLE_DAYS = 3;
export const RECOVERY_LOOKBACK_DAYS = 7;

const DAY_MS = 24 * 3_600_000;

export interface WindowCommitment {
  id: string;
  domain: Domain;
  scheduledStart: Date;
  status: CommitmentStatus;
  rescheduleCount: number;
  /** `versionUsed` was SHORT or MINIMUM — PRD §44: still a completion. */
  fallbackUsed: boolean;
  completedAt: Date | null;
  commitmentType: string | null;
}

export interface DomainWindow {
  domain: Domain;
  now: Date;
  timeZone: string;
  /** Earliest commitment or evidence in this domain, ever. Null = never used. */
  firstActivityAt: Date | null;
  /** `scheduledStart` in [now − 28d, now); any status. */
  commitments: WindowCommitment[];
}

export interface MomentumSignals {
  planned: number;
  completed: number;
  partial: number;
  fallback: number;
  missed: number;
  skipped: number;
  openPastDue: number;
  rescheduledTwice: number;
  ratio: number | null;
  recentRatio: number | null;
  priorRatio: number | null;
  consecutiveMisses: number;
  historyDays: number | null;
  lastCompletionAt: Date | null;
  lastMissAt: Date | null;
  returnedAfterIdleDays: number | null;
}

export interface MomentumResult {
  domain: Domain;
  state: MomentumState;
  evidence: string[];
  signals: MomentumSignals;
}

/** Rows that count as "the user had an intention here and it resolved". */
const SUCCESS_STATUSES: CommitmentStatus[] = ['COMPLETED', 'PARTIALLY_COMPLETED'];
const FAILURE_STATUSES: CommitmentStatus[] = ['MISSED', 'SKIPPED'];
const OPEN_STATUSES: CommitmentStatus[] = ['PLANNED', 'READY'];

/**
 * Whether a row is one the user's behaviour is read from.
 *
 * `CANCELLED` rows were removed by a plan change (E06-04) and `RESCHEDULED`
 * rows were closed by a reschedule whose SUCCESSOR carries the intention
 * (E02-04) — counting either would let a plan edit or a postponement read as a
 * failure, which is the exact thing VISION §31 says must not happen.
 *
 * An open row whose time has passed counts as not done, so the number is the
 * same before and after the E11-02 sweep closes it.
 */
export function isDecided(row: WindowCommitment, now: Date): boolean {
  if (SUCCESS_STATUSES.includes(row.status) || FAILURE_STATUSES.includes(row.status)) {
    return true;
  }
  return OPEN_STATUSES.includes(row.status) && row.scheduledStart < now;
}

function isSuccess(row: WindowCommitment): boolean {
  return SUCCESS_STATUSES.includes(row.status);
}

/** Whole days between two instants, floored, never negative. */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

function ratioOf(rows: WindowCommitment[]): number | null {
  if (rows.length < MIN_PLANNED) return null;
  const successes = rows.filter(isSuccess).length;
  return successes / rows.length;
}

/**
 * The latest return after an absence, in days — or null when there was none.
 *
 * Two conditions, and the second is the one that matters: the gap must contain
 * a miss. A person who trains Monday and Friday has a three-day gap every week
 * and is not recovering from anything; calling that RECOVERING would tell them
 * they lapsed every time they rested.
 */
function returnedAfterIdleDays(
  decided: WindowCommitment[],
  firstActivityAt: Date | null,
  now: Date,
): number | null {
  const successes = decided
    .filter((row) => isSuccess(row) && row.completedAt)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());

  const latest = successes[successes.length - 1];
  if (!latest?.completedAt) return null;
  if (latest.completedAt < new Date(now.getTime() - RECOVERY_LOOKBACK_DAYS * DAY_MS)) {
    return null;
  }

  const previous = successes[successes.length - 2];
  const gapStart = previous?.completedAt ?? firstActivityAt;
  if (!gapStart) return null;

  const days = wholeDaysBetween(gapStart, latest.completedAt);
  if (days < RECOVERY_IDLE_DAYS) return null;

  const missInGap = decided.some(
    (row) =>
      !isSuccess(row) &&
      row.scheduledStart > gapStart &&
      row.scheduledStart < latest.completedAt!,
  );
  if (!missInGap) return null;

  return days;
}

/** The trailing run of not-done rows, oldest-to-newest ordering. */
function consecutiveMissesOf(decided: WindowCommitment[]): number {
  let run = 0;
  for (let i = decided.length - 1; i >= 0; i -= 1) {
    if (isSuccess(decided[i])) break;
    run += 1;
  }
  return run;
}

export function computeSignals(input: DomainWindow): MomentumSignals {
  const { now, firstActivityAt } = input;

  const decided = decidedRows(input);

  const halfPoint = new Date(now.getTime() - HALF_WINDOW_DAYS * DAY_MS);
  const recent = decided.filter((row) => row.scheduledStart >= halfPoint);
  const prior = decided.filter((row) => row.scheduledStart < halfPoint);

  const successes = decided.filter(isSuccess);
  const lastCompletion = successes
    .filter((row) => row.completedAt)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())
    .pop();
  const lastMiss = decided.filter((row) => !isSuccess(row)).pop();

  return {
    planned: decided.length,
    completed: decided.filter((row) => row.status === 'COMPLETED').length,
    partial: decided.filter((row) => row.status === 'PARTIALLY_COMPLETED').length,
    fallback: successes.filter((row) => row.fallbackUsed).length,
    missed: decided.filter((row) => row.status === 'MISSED').length,
    skipped: decided.filter((row) => row.status === 'SKIPPED').length,
    openPastDue: decided.filter((row) => OPEN_STATUSES.includes(row.status)).length,
    rescheduledTwice: decided.filter((row) => row.rescheduleCount >= 2).length,
    ratio: decided.length ? successes.length / decided.length : null,
    recentRatio: ratioOf(recent),
    priorRatio: ratioOf(prior),
    consecutiveMisses: consecutiveMissesOf(decided),
    historyDays: firstActivityAt ? wholeDaysBetween(firstActivityAt, now) : null,
    lastCompletionAt: lastCompletion?.completedAt ?? null,
    lastMissAt: lastMiss?.scheduledStart ?? null,
    returnedAfterIdleDays: returnedAfterIdleDays(decided, firstActivityAt, now),
  };
}

/**
 * The state, by the FIRST matching rule. The order is the contract, not an
 * implementation detail: RECOVERING beats SLIPPING because a person who came
 * back deserves to read that they came back, not that they lapsed.
 */
export function resolveState(signals: MomentumSignals): MomentumState {
  if (signals.planned < MIN_PLANNED) return 'INSUFFICIENT_DATA';

  if (signals.returnedAfterIdleDays !== null) return 'RECOVERING';

  const bothHalves = signals.recentRatio !== null && signals.priorRatio !== null;

  if (
    signals.consecutiveMisses >= SLIP_CONSECUTIVE_MISSES ||
    (bothHalves && signals.priorRatio! - signals.recentRatio! >= TREND_DELTA)
  ) {
    return 'SLIPPING';
  }

  if (
    signals.historyDays !== null &&
    signals.historyDays < BUILDING_MAX_HISTORY_DAYS &&
    signals.ratio !== null &&
    signals.ratio >= BUILDING_MIN_RATIO
  ) {
    return 'BUILDING';
  }

  if (bothHalves && signals.recentRatio! - signals.priorRatio! >= TREND_DELTA) {
    return 'IMPROVING';
  }

  return 'STEADY';
}

/**
 * The whole engine: signals, then state, then the sentences that justify it.
 *
 * `momentum-evidence` imports only TYPES from this file, so the two-way arrow
 * is erased at compile time and there is no runtime cycle.
 */
export function computeMomentum(input: DomainWindow): MomentumResult {
  const signals = computeSignals(input);
  const state = resolveState(signals);
  const decided = decidedRows(input);

  return {
    domain: input.domain,
    state,
    evidence: buildEvidence(signals, input.domain, state, decided, input.now),
    signals,
  };
}

/** The rows momentum is read from, oldest first. Shared by signals and copy. */
export function decidedRows(input: DomainWindow): WindowCommitment[] {
  return input.commitments
    .filter((row) => isDecided(row, input.now))
    .slice()
    .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
}
