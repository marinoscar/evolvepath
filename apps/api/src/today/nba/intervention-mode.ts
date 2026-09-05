// =============================================================================
// Which coaching posture today calls for (issue #38, epic E05)
// =============================================================================
//
// VISION §21's eight modes, resolved by the FIRST MATCHING RULE in the order
// below. Order is the whole design: every rule below could be true at once for
// a user having a hard week, and the one that wins decides what the product
// says to them.
//
// The ordering principle is "address the biggest thing first, and address a
// person before a plan":
//
//   RECOVER        they have been gone. Nothing else matters until they are back.
//   CHALLENGE_PLAN the plan itself keeps failing. Trying harder is the wrong ask.
//   DIAGNOSE       this one thing keeps moving. Name it before pushing.
//   REDUCE         they told us the day is full. Believe them.
//   RECONNECT      they told us they are depleted. Motive beats mechanics.
//   CLARIFY        we do not know why this matters. Ask before pushing.
//   REINFORCE      it is going well. Say so.
//   ACT            get on with it.
//
// PURE: no dates are computed here, only compared. The caller supplies the
// counts.
// =============================================================================

export const INTERVENTION_MODES = [
  'ACT',
  'CLARIFY',
  'REDUCE',
  'DIAGNOSE',
  'RECONNECT',
  'CHALLENGE_PLAN',
  'RECOVER',
  'REINFORCE',
] as const;

export type InterventionMode = (typeof INTERVENTION_MODES)[number];

export interface InterventionContext {
  /** Null when the user has never logged anything — a new account, not a lapse. */
  daysSinceLastEvidence: number | null;
  hasAnyEvidence: boolean;
  /** MISSED + SKIPPED occurrences of the top candidate's routine, last 14 days. */
  routineFailuresLast14Days: number;
  topRescheduleCount: number;
  checkIn: 'NORMAL' | 'PACKED' | 'LOW_ENERGY' | 'UNEXPECTED_PROBLEM' | null;
  chosenMinutes: number;
  availableMinutesRemaining: number;
  /** True when the top candidate's outcome states neither motive nor success. */
  outcomeLacksMeaning: boolean;
  completionsLast7Days: number;
  missesLast7Days: number;
}

/** Three days away is a lapse worth naming; two is a weekend. */
export const RECOVER_DAYS = 3;
/** Four failures in a fortnight is the plan failing, not the person. */
export const CHALLENGE_PLAN_FAILURES = 4;
/** Moved twice is a pattern; moved once is a Tuesday. */
export const DIAGNOSE_RESCHEDULES = 2;
/** Three wins in a week with nothing missed is worth saying out loud. */
export const REINFORCE_COMPLETIONS = 3;

export function resolveInterventionMode(ctx: InterventionContext): InterventionMode {
  // A brand-new account has no evidence and has not lapsed — those are different
  // states and only one of them deserves a "welcome back".
  if (
    ctx.hasAnyEvidence &&
    ctx.daysSinceLastEvidence !== null &&
    ctx.daysSinceLastEvidence >= RECOVER_DAYS
  ) {
    return 'RECOVER';
  }

  if (ctx.routineFailuresLast14Days >= CHALLENGE_PLAN_FAILURES) return 'CHALLENGE_PLAN';

  if (ctx.topRescheduleCount >= DIAGNOSE_RESCHEDULES) return 'DIAGNOSE';

  // Either they said the day is full, or the arithmetic says it is.
  if (
    ctx.checkIn === 'PACKED' ||
    ctx.checkIn === 'UNEXPECTED_PROBLEM' ||
    ctx.chosenMinutes > ctx.availableMinutesRemaining
  ) {
    return 'REDUCE';
  }

  if (ctx.checkIn === 'LOW_ENERGY') return 'RECONNECT';

  if (ctx.outcomeLacksMeaning) return 'CLARIFY';

  if (ctx.completionsLast7Days >= REINFORCE_COMPLETIONS && ctx.missesLast7Days === 0) {
    return 'REINFORCE';
  }

  return 'ACT';
}
