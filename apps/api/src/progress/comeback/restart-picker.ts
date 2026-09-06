import type { DomainModeKind } from '@prisma/client';

import type { Domain } from '../momentum/momentum-engine';
import {
  DEFAULT_RESTART_REASON,
  DEFAULT_RESTART_TITLE,
  REASON_TEMPLATES,
} from './comeback-copy';

// =============================================================================
// The one thing to offer (issue #112, epic E11)
// =============================================================================
//
// PRD §56: "create ONE restart action". Not a list, not a prioritised backlog —
// one, plus the two alternatives a user needs in order to feel they chose.
//
// Pure, because the ordering is the product decision and it has to be readable
// as a rule rather than inferred from a query plan. VISION §32's "recommended
// restart" is rebuilt from what the user was already keeping; a return is not
// the moment to introduce a new habit.
// =============================================================================

/** Never smaller than this — a two-minute restart is not a restart. */
export const RESTART_MIN_MINUTES = 10;
/** Never larger than this — a return must be winnable on the first day. */
export const RESTART_MAX_MINUTES = 15;

/** Ties break here (VISION §56: "a ten-minute health action or small Work start"). */
export const DOMAIN_PREFERENCE: Domain[] = ['HEALTH', 'WORK', 'FAMILY'];

export interface RestartCandidate {
  domain: Domain;
  mode: DomainModeKind;
  outcomeId: string;
  outcomeTitle: string;
  outcomeImportance: number;
  planVersionId: string;
  routineId: string;
  routineTitle: string;
  minimumDurationMin: number | null;
  fallbackBehavior: string | null;
  preferredTime: string | null;
  /** From the momentum signals — when this domain last went right. */
  lastCompletionAt: Date | null;
}

export interface RestartAlternative {
  domain: Domain;
  title: string;
  minutes: number;
}

export interface RestartPlan {
  domain: Domain;
  routineId: string | null;
  outcomeId: string | null;
  planVersionId: string | null;
  title: string;
  minutes: number;
  preferredTime: string | null;
  reason: string;
  alternatives: RestartAlternative[];
}

export function clampRestartMinutes(minutes: number | null | undefined): number {
  const value = minutes ?? RESTART_MIN_MINUTES;
  return Math.min(RESTART_MAX_MINUTES, Math.max(RESTART_MIN_MINUTES, value));
}

/** The smallest honest name for this routine. */
function titleOf(candidate: RestartCandidate): string {
  return candidate.fallbackBehavior ?? candidate.routineTitle;
}

/**
 * The ranking, in order: importance, then recency of success, then the fixed
 * domain preference. A `PAUSE` domain is excluded outright — the user put it
 * down deliberately, and offering it back is the product overruling them.
 */
function rank(a: RestartCandidate, b: RestartCandidate): number {
  if (a.outcomeImportance !== b.outcomeImportance) {
    return b.outcomeImportance - a.outcomeImportance;
  }

  const aLast = a.lastCompletionAt?.getTime() ?? 0;
  const bLast = b.lastCompletionAt?.getTime() ?? 0;
  if (aLast !== bLast) return bLast - aLast;

  return DOMAIN_PREFERENCE.indexOf(a.domain) - DOMAIN_PREFERENCE.indexOf(b.domain);
}

/** Which rule actually decided, so the sentence matches the choice. */
function reasonFor(winner: RestartCandidate, eligible: RestartCandidate[]): string {
  const contenders = eligible.filter(
    (c) => c.outcomeImportance === winner.outcomeImportance,
  );

  if (contenders.length === 1) {
    return REASON_TEMPLATES.mostImportant(winner.domain, winner.outcomeTitle);
  }
  if (winner.lastCompletionAt) {
    return REASON_TEMPLATES.mostRecent(winner.domain);
  }
  return REASON_TEMPLATES.fallbackDomain(winner.domain);
}

export function pickRestart(candidates: RestartCandidate[]): RestartPlan {
  const eligible = candidates.filter((candidate) => candidate.mode !== 'PAUSE');

  if (eligible.length === 0) {
    // Not an error state. A user with no active routine still deserves an
    // offer, and a walk is the one restart that needs no plan behind it.
    return {
      domain: 'HEALTH',
      routineId: null,
      outcomeId: null,
      planVersionId: null,
      title: DEFAULT_RESTART_TITLE,
      minutes: RESTART_MIN_MINUTES,
      preferredTime: null,
      reason: DEFAULT_RESTART_REASON,
      alternatives: [],
    };
  }

  const ordered = eligible.slice().sort(rank);
  const winner = ordered[0];

  // One alternative per OTHER domain — the best of each, so the choice is
  // "which part of my life", not "which of eleven routines".
  const alternatives: RestartAlternative[] = [];
  for (const domain of DOMAIN_PREFERENCE) {
    if (domain === winner.domain) continue;
    const best = ordered.find((candidate) => candidate.domain === domain);
    if (!best) continue;
    alternatives.push({
      domain,
      title: titleOf(best),
      minutes: clampRestartMinutes(best.minimumDurationMin),
    });
  }

  return {
    domain: winner.domain,
    routineId: winner.routineId,
    outcomeId: winner.outcomeId,
    planVersionId: winner.planVersionId,
    title: titleOf(winner),
    minutes: clampRestartMinutes(winner.minimumDurationMin),
    preferredTime: winner.preferredTime,
    reason: reasonFor(winner, eligible),
    alternatives,
  };
}

/**
 * The restart for a domain the user named, or null when there is none.
 *
 * The alternatives are recomputed against the CHOSEN domain rather than reused
 * from the original offer — after switching to Work, "Health" has to be
 * offerable again or the user cannot change their mind twice.
 */
export function pickForDomain(
  candidates: RestartCandidate[],
  domain: Domain,
): RestartPlan | null {
  const inDomain = candidates.filter(
    (candidate) => candidate.domain === domain && candidate.mode !== 'PAUSE',
  );
  if (inDomain.length === 0) return null;

  const plan = pickRestart(inDomain);
  const others = pickRestart(
    candidates.filter((candidate) => candidate.domain !== domain),
  );

  return {
    ...plan,
    alternatives: others.routineId === null ? [] : [
      { domain: others.domain, title: others.title, minutes: others.minutes },
      ...others.alternatives,
    ].filter((alt) => alt.domain !== domain),
  };
}
