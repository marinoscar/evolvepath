// =============================================================================
// The deterministic next-best-action scorer (issue #38, epic E05)
// =============================================================================
//
// PRD §13: "The AI should not freely invent priority. The deterministic engine
// generates candidates." This file IS that engine, and three properties follow
// from that sentence:
//
//   1. PURE. No Prisma, no `Date.now()`, no I/O. `now` arrives on the context.
//      Two calls with the same inputs return the same ranking, which is what
//      makes "why did it suggest that?" a question with an answer.
//   2. ADDITIVE, with the weights as named exports. Every term is
//      `weight × factor` where factor ∈ [0,1], so the breakdown sums to the
//      score and no term can silently dominate.
//   3. EXPLAINABLE. `scoreCandidate` returns the breakdown alongside the total.
//      The rationale the user reads is built from the mode and the candidate,
//      but the breakdown is what makes a support conversation possible.
//
// The weights are code constants rather than configuration on purpose: a
// per-installation weight would make every user's ranking a different product,
// and the one report we could not then investigate is "the suggestions got
// worse".
// =============================================================================

export const IMPORTANCE_WEIGHT = 30;
export const URGENCY_WEIGHT = 25;
export const REPEATED_AVOIDANCE_WEIGHT = 20;
export const PLAN_RELEVANCE_WEIGHT = 10;
export const DOMAIN_BALANCE_WEIGHT = 10;
export const CONTEXTUAL_FIT_WEIGHT = 10;

export const EFFORT_MISMATCH_PENALTY = 25;
export const CONFLICT_PENALTY = 40;
export const FATIGUE_PENALTY = 15;

export type Domain = 'WORK' | 'FAMILY' | 'HEALTH';
export type DomainModeValue = 'GROW' | 'MAINTAIN' | 'RECOVER' | 'PAUSE';
export type CheckInFeel = 'NORMAL' | 'PACKED' | 'LOW_ENERGY' | 'UNEXPECTED_PROBLEM';

export interface CandidateVersion {
  title: string;
  minutes: number;
}

export interface CandidateCommitment {
  id: string;
  domain: Domain;
  /** 1–5. */
  importance: number;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  /** Terminal statuses are not candidates; the loader filters them out. */
  status: 'PLANNED' | 'READY' | 'STARTED';
  rescheduleCount: number;
  planId: string | null;
  planIsActive: boolean;
  outcomeTargetDate: Date | null;
  versions: {
    full: CandidateVersion;
    short: CandidateVersion | null;
    minimum: CandidateVersion | null;
  };
  createdAt: Date;
}

export interface ScoringContext {
  now: Date;
  checkIn: CheckInFeel | null;
  domainModes: Record<Domain, DomainModeValue>;
  completedTodayByDomain: Record<Domain, number>;
  /** `weekdayMinutes` minus what today already consumed, floored at zero. */
  availableMinutesRemaining: number;
  /** Any commitment of this user already STARTED today. */
  startedCommitmentId: string | null;
}

export interface CandidateInput {
  commitment: CandidateCommitment;
  context: ScoringContext;
  /** The minutes of the version the sizer chose for THIS candidate. */
  chosenMinutes: number;
}

export interface ScoreBreakdown {
  importance: number;
  urgency: number;
  repeatedAvoidance: number;
  planRelevance: number;
  domainBalance: number;
  contextualFit: number;
  effortMismatch: number;
  conflict: number;
  fatigue: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Penalties are stored negative so the breakdown sums to the score. `-0` is
 * avoided deliberately: it serialises as `-0` in JSON and reads as a bug in a
 * support conversation about a score.
 */
const negate = (value: number): number => (value === 0 ? 0 : -value);

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** GROW pushes hardest; RECOVER still moves; MAINTAIN holds the line. */
const MODE_FACTOR: Record<Exclude<DomainModeValue, 'PAUSE'>, number> = {
  GROW: 1,
  RECOVER: 0.75,
  MAINTAIN: 0.5,
};

/** How much a stated feeling discounts a long action. */
const FEEL_FACTOR: Record<CheckInFeel, number> = {
  LOW_ENERGY: 1,
  PACKED: 0.5,
  UNEXPECTED_PROBLEM: 0.5,
  NORMAL: 0,
};

/** How near the scheduled time is, on a twelve-hour ramp. Overdue is 1. */
function scheduleUrgency(commitment: CandidateCommitment, now: Date): number {
  const hoursUntil = (commitment.scheduledStart.getTime() - now.getTime()) / HOUR_MS;

  return clamp01(1 - hoursUntil / 12);
}

/** How near the outcome's target date is, on a seven-day ramp. */
function deadlineUrgency(commitment: CandidateCommitment, now: Date): number {
  if (!commitment.outcomeTargetDate) return 0;

  const daysUntil = (commitment.outcomeTargetDate.getTime() - now.getTime()) / DAY_MS;

  return clamp01(1 - daysUntil / 7);
}

/**
 * One candidate's score and the terms that produced it.
 *
 * Throws on a PAUSED domain. That is a programming error rather than a data
 * state: the loader excludes paused domains from candidates, and a paused
 * commitment reaching here means the two disagree — which would show up as a
 * suggestion to do something the user explicitly put down.
 */
export function scoreCandidate(input: CandidateInput): {
  score: number;
  breakdown: ScoreBreakdown;
} {
  const { commitment, context, chosenMinutes } = input;
  const mode = context.domainModes[commitment.domain];

  if (mode === 'PAUSE') {
    throw new Error(
      `Candidate ${commitment.id} is in a PAUSED domain (${commitment.domain}); the loader must exclude it`,
    );
  }

  const importance = IMPORTANCE_WEIGHT * clamp01(commitment.importance / 5);

  const urgency =
    URGENCY_WEIGHT *
    Math.max(scheduleUrgency(commitment, context.now), deadlineUrgency(commitment, context.now));

  // Read from the LIVE row: a reschedule carries the count onto the commitment
  // it creates, so "moved three times" survives the move.
  const repeatedAvoidance =
    REPEATED_AVOIDANCE_WEIGHT * (Math.min(commitment.rescheduleCount, 3) / 3);

  // A quick-add with no plan scores zero here rather than being excluded: it is
  // still something the user said they would do.
  const planRelevance =
    PLAN_RELEVANCE_WEIGHT * (commitment.planIsActive ? 1 : commitment.planId ? 0.5 : 0);

  const domainBalance =
    DOMAIN_BALANCE_WEIGHT *
    MODE_FACTOR[mode] *
    (context.completedTodayByDomain[commitment.domain] === 0 ? 1 : 0.25);

  const windowEnd =
    commitment.scheduledEnd ??
    new Date(commitment.scheduledStart.getTime() + chosenMinutes * 60_000);
  const inWindow =
    context.now.getTime() >= commitment.scheduledStart.getTime() - 60 * 60_000 &&
    context.now.getTime() <= windowEnd.getTime() + 60 * 60_000;
  const contextualFit = CONTEXTUAL_FIT_WEIGHT * (inWindow ? 1 : 0);

  const effortMismatch =
    EFFORT_MISMATCH_PENALTY * (chosenMinutes > context.availableMinutesRemaining ? 1 : 0);

  // Self-started is not a conflict — it is the thing in progress.
  const conflict =
    CONFLICT_PENALTY *
    (context.startedCommitmentId && context.startedCommitmentId !== commitment.id ? 1 : 0);

  const fatigue =
    FATIGUE_PENALTY *
    (context.checkIn ? FEEL_FACTOR[context.checkIn] : 0) *
    clamp01(chosenMinutes / 60);

  const breakdown: ScoreBreakdown = {
    importance,
    urgency,
    repeatedAvoidance,
    planRelevance,
    domainBalance,
    contextualFit,
    effortMismatch: negate(effortMismatch),
    conflict: negate(conflict),
    fatigue: negate(fatigue),
  };

  const score = Object.values(breakdown).reduce((sum, term) => sum + term, 0);

  return { score, breakdown };
}

/**
 * Candidates best-first.
 *
 * STABLE, and the tie-break chain is the point: equal scores resolve by earlier
 * `scheduledStart`, then earlier `createdAt`, then id. Without it, two equally
 * good commitments would swap places between two identical requests, and a user
 * refreshing Today would watch the suggestion flicker.
 */
export function rankCandidates(candidates: CandidateInput[]): CandidateInput[] {
  return [...candidates]
    .map((candidate) => ({ candidate, ...scoreCandidate(candidate) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const startDelta =
        a.candidate.commitment.scheduledStart.getTime() -
        b.candidate.commitment.scheduledStart.getTime();
      if (startDelta !== 0) return startDelta;

      const createdDelta =
        a.candidate.commitment.createdAt.getTime() - b.candidate.commitment.createdAt.getTime();
      if (createdDelta !== 0) return createdDelta;

      return a.candidate.commitment.id.localeCompare(b.candidate.commitment.id);
    })
    .map((entry) => entry.candidate);
}

/**
 * How sure the engine is, as the gap between first and second place.
 *
 * Bounded well away from both extremes: 0.95 because a deterministic ranking
 * over incomplete information is never certain, and 0.2 because a close call is
 * still a real recommendation and the UI should not present it as a coin flip.
 * A single candidate is 0.9 — there is nothing to be unsure between.
 */
export function confidenceOf(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return 0.9;

  const [top, second] = scores;

  return Math.min(0.95, Math.max(0.2, (top - second) / Math.max(top, 1)));
}
