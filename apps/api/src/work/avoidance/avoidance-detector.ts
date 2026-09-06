import { INTERVENTION_TYPES } from '../../coach/contracts/coach-reply.contract';

// =============================================================================
// The intervention ladder (issue #116, epic E07)
// =============================================================================
//
// PRD §26 fixes seven rungs, from a normal reminder to challenging the goal
// itself. PRD §25 fixes the signals and one rule that matters more than any of
// them: AVOIDANCE MUST NOT BE INFERRED FROM ONE MISS. A single reschedule, a
// single skip and a single "later" each leave the user on level 0, because a
// product that escalates on a Tuesday is a product people stop opening.
//
// -----------------------------------------------------------------------------
// THE RULE, VERBATIM. `docs/specs/work-domain.md` copies this block.
// -----------------------------------------------------------------------------
//
// 1. A signal is ACTIVE when it crosses its threshold:
//
//      RESCHEDULED_TWICE              rescheduleCount >= 2
//      UNCHANGED_3_DAYS               daysUnchanged >= 3
//      SHORT_SKIPS                    shortSkipCount >= 2
//      EXPLICIT_LATER                 explicitLaterCount >= 2,
//                                     or >= 1 when any other signal is active
//      DISPLACED_BY_LOWER_IMPORTANCE  displacedByLowerImportanceCount >= 2
//      SAME_WINDOW_FAILURES           sameWindowFailureCount >= 3
//
//    No active signal -> level 0, and stop.
//
// 2. `base` is the highest rung among the signals active by their OWN
//    threshold:
//
//      UNCHANGED_3_DAYS               1
//      SHORT_SKIPS                    2
//      RESCHEDULED_TWICE              3
//      EXPLICIT_LATER                 3
//      DISPLACED_BY_LOWER_IMPORTANCE  4
//      SAME_WINDOW_FAILURES           5
//
// 3. `extra` is the occurrences beyond each active signal's threshold, summed
//    and clamped at zero. An EXPLICIT_LATER active only by the "at least one,
//    alongside another signal" clause contributes `explicitLaterCount` itself
//    and does NOT raise `base` — one "later" is corroboration, not a rung.
//    The level rises ONE STEP PER ADDITIONAL OCCURRENCE: level = base + extra.
//
// 4. Caps:
//      * level <= 4 unless weeksOfEvidence >= 3. Levels 5 and 6 challenge the
//        PLAN and the GOAL, and PRD §26 L6 says "for three weeks" — you cannot
//        tell somebody their plan is wrong on the evidence of four days.
//      * level 5 additionally requires SAME_WINDOW_FAILURES active (PRD §26 L5
//        is "keeps failing at 4 PM"); otherwise clamp to 4.
//      * final level = min(level, 6).
//
// -----------------------------------------------------------------------------
// PURE. No Nest, no Prisma, no `Date`.
// -----------------------------------------------------------------------------
//
// It takes numbers and returns an assessment, which is what makes one test per
// level trivial and what keeps the dates — every one of which is a timezone
// question — in `avoidance-signals.service.ts` where they can be reasoned about
// once.
// =============================================================================

export enum AvoidanceLevel {
  NORMAL_REMINDER = 0,
  ACTIVATION_REDUCTION = 1,
  DECOMPOSITION = 2,
  FRICTION_DIAGNOSIS = 3,
  ENVIRONMENT_CHANGE = 4,
  PLAN_CHALLENGE = 5,
  GOAL_CHALLENGE = 6,
}

export type AvoidanceSignalKey =
  | 'RESCHEDULED_TWICE'
  | 'UNCHANGED_3_DAYS'
  | 'SHORT_SKIPS'
  | 'EXPLICIT_LATER'
  | 'DISPLACED_BY_LOWER_IMPORTANCE'
  | 'SAME_WINDOW_FAILURES';

export interface AvoidanceSignals {
  /** `Commitment.rescheduleCount`, which travels with the intention. */
  rescheduleCount: number;
  /** Whole local days in PLANNED/READY/RESCHEDULED with no evidence at all. */
  daysUnchanged: number;
  /** SKIPPED or MISSED commitments of the same outcome, last 14 days. */
  shortSkipCount: number;
  /** Same-outcome skips reading as "later"/"tomorrow"/"not now", last 14 days. */
  explicitLaterCount: number;
  /** Days this was due and untouched while something less important got done. */
  displacedByLowerImportanceCount: number;
  /** Same-outcome failures in the same time window, last 21 days. */
  sameWindowFailureCount: number;
  /** Whole weeks since the outcome was created. Gates levels 5 and 6. */
  weeksOfEvidence: number;
}

export type SuggestedAction =
  | 'NONE'
  | 'MINIMUM'
  | 'DECOMPOSE'
  | 'FRICTION_QUESTION'
  | 'ENVIRONMENT'
  | 'PLAN_REVIEW';

export interface AvoidanceAssessment {
  level: AvoidanceLevel;
  interventionType: (typeof INTERVENTION_TYPES)[number];
  signals: AvoidanceSignalKey[];
  /** A fixed sentence with the numbers substituted. Never AI-written. */
  rationale: string;
  suggestedAction: SuggestedAction;
}

/** The threshold at which each signal turns on, and the rung it carries. */
const SIGNAL_RULES: Array<{
  key: AvoidanceSignalKey;
  rung: AvoidanceLevel;
  threshold: number;
  count: (s: AvoidanceSignals) => number;
}> = [
  {
    key: 'UNCHANGED_3_DAYS',
    rung: AvoidanceLevel.ACTIVATION_REDUCTION,
    threshold: 3,
    count: (s) => s.daysUnchanged,
  },
  {
    key: 'SHORT_SKIPS',
    rung: AvoidanceLevel.DECOMPOSITION,
    threshold: 2,
    count: (s) => s.shortSkipCount,
  },
  {
    key: 'RESCHEDULED_TWICE',
    rung: AvoidanceLevel.FRICTION_DIAGNOSIS,
    threshold: 2,
    count: (s) => s.rescheduleCount,
  },
  {
    key: 'EXPLICIT_LATER',
    rung: AvoidanceLevel.FRICTION_DIAGNOSIS,
    threshold: 2,
    count: (s) => s.explicitLaterCount,
  },
  {
    key: 'DISPLACED_BY_LOWER_IMPORTANCE',
    rung: AvoidanceLevel.ENVIRONMENT_CHANGE,
    threshold: 2,
    count: (s) => s.displacedByLowerImportanceCount,
  },
  {
    key: 'SAME_WINDOW_FAILURES',
    rung: AvoidanceLevel.PLAN_CHALLENGE,
    threshold: 3,
    count: (s) => s.sameWindowFailureCount,
  },
];

/** Levels 5 and 6 need three weeks of evidence (PRD §26 L6). */
export const WEEKS_FOR_PLAN_CHALLENGE = 3;

/** The PRD §26 name for each rung. All seven are `INTERVENTION_TYPES` members. */
export const INTERVENTION_TYPE_BY_LEVEL = [
  'NORMAL_REMINDER',
  'ACTIVATION_REDUCTION',
  'DECOMPOSITION',
  'FRICTION_DIAGNOSIS',
  'ENVIRONMENT_CHANGE',
  'PLAN_CHALLENGE',
  'GOAL_CHALLENGE',
] as const;

const SUGGESTED_ACTION_BY_LEVEL: SuggestedAction[] = [
  'NONE',
  'MINIMUM',
  'DECOMPOSE',
  'FRICTION_QUESTION',
  'ENVIRONMENT',
  'PLAN_REVIEW',
  'PLAN_REVIEW',
];

/** Where this commitment sits on the ladder, and what to offer because of it. */
export function detectAvoidance(
  signals: AvoidanceSignals,
  opts: { askedRecently?: boolean } = {},
): AvoidanceAssessment {
  const strong = SIGNAL_RULES.filter((rule) => rule.count(signals) >= rule.threshold);

  // The corroborating clause: one "later" counts only alongside something else.
  const weakLater =
    strong.every((rule) => rule.key !== 'EXPLICIT_LATER') &&
    signals.explicitLaterCount >= 1 &&
    strong.length > 0;

  const active: AvoidanceSignalKey[] = [
    ...strong.map((rule) => rule.key),
    ...(weakLater ? (['EXPLICIT_LATER'] as AvoidanceSignalKey[]) : []),
  ];

  if (active.length === 0) {
    return {
      level: AvoidanceLevel.NORMAL_REMINDER,
      interventionType: 'NORMAL_REMINDER',
      signals: [],
      rationale: 'Nothing here looks avoided.',
      suggestedAction: 'NONE',
    };
  }

  const base = strong.reduce((max, rule) => Math.max(max, rule.rung), 0);

  const extra =
    strong.reduce((sum, rule) => sum + Math.max(0, rule.count(signals) - rule.threshold), 0) +
    (weakLater ? signals.explicitLaterCount : 0);

  let level = base + extra;

  if (signals.weeksOfEvidence < WEEKS_FOR_PLAN_CHALLENGE) {
    level = Math.min(level, AvoidanceLevel.ENVIRONMENT_CHANGE);
  } else if (
    level >= AvoidanceLevel.PLAN_CHALLENGE &&
    !active.includes('SAME_WINDOW_FAILURES')
  ) {
    // PRD §26 L5 is "keeps failing at 4 PM". Without that shape, the plan is
    // not the thing to challenge, however many times this one thing moved.
    level = AvoidanceLevel.ENVIRONMENT_CHANGE;
  }

  level = Math.min(level, AvoidanceLevel.GOAL_CHALLENGE) as AvoidanceLevel;

  return {
    level,
    interventionType: INTERVENTION_TYPE_BY_LEVEL[level],
    // Sorted so the same signals always read in the same order — the array is
    // rendered on a card and compared in a test.
    signals: [...active].sort(),
    rationale: rationaleFor(level, signals, active),
    suggestedAction:
      level === AvoidanceLevel.FRICTION_DIAGNOSIS && opts.askedRecently
        ? // Asked once. PRD §25's question is a diagnosis, not a nag: having
          // heard the answer, the product owes the user an action instead.
          'DECOMPOSE'
        : SUGGESTED_ACTION_BY_LEVEL[level],
  };
}

/**
 * The sentence the card shows, with the counts in it.
 *
 * DETERMINISTIC AND SUBSTITUTED, never generated. It is shown when the model is
 * down, it is quoted in the next-best-action rationale, and a user reading
 * "moved 2 times, untouched for 4 days" can check it against their own memory —
 * which is exactly the credibility a generated sentence would not have.
 */
function rationaleFor(
  level: AvoidanceLevel,
  signals: AvoidanceSignals,
  active: AvoidanceSignalKey[],
): string {
  const facts: string[] = [];

  if (active.includes('RESCHEDULED_TWICE')) {
    facts.push(`moved ${signals.rescheduleCount} times`);
  }
  if (active.includes('UNCHANGED_3_DAYS')) {
    facts.push(`untouched for ${signals.daysUnchanged} days`);
  }
  if (active.includes('SHORT_SKIPS')) {
    facts.push(`skipped ${signals.shortSkipCount} times in this outcome`);
  }
  if (active.includes('EXPLICIT_LATER')) {
    facts.push(`put off ${signals.explicitLaterCount} times`);
  }
  if (active.includes('DISPLACED_BY_LOWER_IMPORTANCE')) {
    facts.push(
      `passed over ${signals.displacedByLowerImportanceCount} times for smaller things`,
    );
  }
  if (active.includes('SAME_WINDOW_FAILURES')) {
    facts.push(`failed ${signals.sameWindowFailureCount} times in the same part of the day`);
  }

  const evidence = facts.join(', ');

  switch (level) {
    case AvoidanceLevel.ACTIVATION_REDUCTION:
      return `This has been ${evidence}. Make the first step smaller.`;
    case AvoidanceLevel.DECOMPOSITION:
      return `This has been ${evidence}. It is probably too big as one task.`;
    case AvoidanceLevel.FRICTION_DIAGNOSIS:
      return `This has been ${evidence}. Worth asking what is making it hard to start.`;
    case AvoidanceLevel.ENVIRONMENT_CHANGE:
      return `This has been ${evidence}. The conditions around it may be the problem.`;
    case AvoidanceLevel.PLAN_CHALLENGE:
      return `This has been ${evidence}. The plan, not the effort, looks like the issue.`;
    case AvoidanceLevel.GOAL_CHALLENGE:
      return `This has been ${evidence}. Worth asking whether this is still the right goal.`;
    default:
      return 'Nothing here looks avoided.';
  }
}
