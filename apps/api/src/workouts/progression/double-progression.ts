// =============================================================================
// Double progression (issue #85, epic E09)
// =============================================================================
//
// PRD §42, verbatim: "Progression should initially use conservative
// deterministic rules … The core progression rule should not be reinvented by
// the LLM every workout. The AI can explain."
//
// So this file is the rule and there is no model in it. Not "a model with a
// deterministic fallback" — the rule, always, with an optional sentence written
// about it afterwards. Three reasons that all matter:
//
//   1. IT MUST BE THE SAME EVERY WEEK. A number that drifts because a model was
//      feeling generous is not progression, it is noise the user has to audit.
//   2. IT MUST WORK WITH THE PROVIDER DOWN (PRD §120). The suggestion is on the
//      runner screen; a missing one is a user standing at a rack guessing.
//   3. IT MUST BE READABLE. The whole rule is on one page below, which is what
//      lets `docs/specs/health-domain.md` state it verbatim and a spec assert
//      each row of it.
//
// PURE: no Prisma, no Nest, no clock. The fixtures spec runs in milliseconds and
// the session view, the explainer and the docs all read the same function.
//
// CONSERVATIVE MEANS TWO SESSIONS, NOT ONE. One good day is a good day; two is
// a trend. Increasing off a single session is how a beginner ends up adding
// weight they cannot control in week three.
// =============================================================================

export type Discomfort = 'NONE' | 'MILD' | 'SHARP_PAIN';

export interface SetRecord {
  weightKg: number | null;
  reps: number;
  rpe: number | null;
  discomfort: Discomfort;
}

export interface SessionRecord {
  sessionId: string;
  /** ISO. Carried for the explanation, never used in the arithmetic. */
  date: string;
  /** Ordered by set number. */
  sets: SetRecord[];
}

export interface Prescription {
  sets: number;
  repMin: number;
  repMax: number;
  equipment: string[];
}

export type ProgressionAction = 'increase' | 'hold' | 'reduce';

export type ProgressionReason =
  | 'top_of_range_twice'
  | 'below_min_twice'
  | 'first_session'
  | 'building'
  | 'discomfort'
  | 'insufficient_history';

export interface ProgressionSuggestion {
  action: ProgressionAction;
  /** Last session's heaviest working weight. */
  currentWeightKg: number | null;
  /** Null for bodyweight and bands — there is no load to name. */
  suggestedWeightKg: number | null;
  deltaKg: number | null;
  reason: ProgressionReason;
  basis: { sessions: number; lastReps: number[]; lastRpe: Array<number | null> };
}

/**
 * The smallest honest jump per implement.
 *
 * A dumbbell pair goes up in 2.5 kg steps because that is what a rack holds; a
 * barbell in 5 kg because that is the smallest pair of plates most rooms own.
 * These are equipment facts, not tuning parameters.
 */
export const INCREMENT_KG: Record<string, number> = {
  DUMBBELL: 2.5,
  BARBELL: 5,
  KETTLEBELL: 4,
  MACHINE: 5,
  CABLE: 2.5,
};

/** The RPE at or below which a set counts as comfortable. */
export const COMFORTABLE_RPE = 8;

/** What a reduction multiplies the current load by. */
export const REDUCE_FACTOR = 0.95;

/** Every weight the product ever names is a multiple of this. */
export const WEIGHT_STEP_KG = 0.25;

export function roundToStep(value: number): number {
  return Math.round(value / WEIGHT_STEP_KG) * WEIGHT_STEP_KG;
}

/** The first loadable implement the prescription names, if any. */
export function incrementFor(equipment: string[]): number | null {
  for (const item of equipment) {
    const increment = INCREMENT_KG[item];

    if (increment !== undefined) return increment;
  }

  return null;
}

function heaviest(session: SessionRecord): number | null {
  const weights = session.sets
    .map((set) => set.weightKg)
    .filter((weight): weight is number => weight !== null);

  return weights.length > 0 ? Math.max(...weights) : null;
}

/** Every logged set reached the top of the range, and none of them was a grind. */
function toppedOut(session: SessionRecord, p: Prescription): boolean {
  return (
    session.sets.length >= p.sets &&
    session.sets.every(
      (set) => set.reps >= p.repMax && (set.rpe === null || set.rpe <= COMFORTABLE_RPE),
    )
  );
}

/** At least one set fell under the bottom of the range. */
function missedFloor(session: SessionRecord, p: Prescription): boolean {
  return session.sets.some((set) => set.reps < p.repMin);
}

/**
 * What to do with this movement today.
 *
 * @param history Newest session first, at most two. Callers pass COMPLETED
 *   sessions only — an abandoned one is not evidence of anything.
 */
export function suggestProgression(
  history: SessionRecord[],
  p: Prescription,
): ProgressionSuggestion {
  const recent = history.slice(0, 2);
  const last = recent[0] ?? null;
  const currentWeightKg = last ? heaviest(last) : null;

  const basis = {
    sessions: recent.length,
    lastReps: last?.sets.map((set) => set.reps) ?? [],
    lastRpe: last?.sets.map((set) => set.rpe) ?? [],
  };

  const hold = (reason: ProgressionReason): ProgressionSuggestion => ({
    action: 'hold',
    currentWeightKg,
    suggestedWeightKg: currentWeightKg,
    deltaKg: null,
    reason,
    basis,
  });

  // 1. Nothing to go on.
  if (!last) return { ...hold('first_session'), suggestedWeightKg: null };

  // 2. Pain outranks every other rule. E09-03 already showed the safety copy;
  //    this must not follow it with "add 2.5 kg".
  if (last.sets.some((set) => set.discomfort === 'SHARP_PAIN')) return hold('discomfort');

  // 3. Two sessions at the top of the range, comfortably.
  if (recent.length >= 2 && recent.every((session) => toppedOut(session, p))) {
    const delta = incrementFor(p.equipment);

    // Bodyweight and bands top out too, and there is no plate to add. The
    // action is still `increase` — the client says "add a rep or make it
    // harder" — because reporting `hold` would tell a user who is plainly
    // progressing that they are not.
    if (delta === null || currentWeightKg === null) {
      return {
        action: 'increase',
        currentWeightKg,
        suggestedWeightKg: null,
        deltaKg: null,
        reason: 'top_of_range_twice',
        basis,
      };
    }

    return {
      action: 'increase',
      currentWeightKg,
      suggestedWeightKg: roundToStep(currentWeightKg + delta),
      deltaKg: delta,
      reason: 'top_of_range_twice',
      basis,
    };
  }

  // 4. Two sessions under the floor. Something is too heavy.
  if (recent.length >= 2 && recent.every((session) => missedFloor(session, p))) {
    if (currentWeightKg === null) return hold('below_min_twice');

    const suggested = roundToStep(currentWeightKg * REDUCE_FACTOR);

    return {
      action: 'reduce',
      currentWeightKg,
      suggestedWeightKg: suggested,
      deltaKg: roundToStep(suggested - currentWeightKg),
      reason: 'below_min_twice',
      basis,
    };
  }

  // 5. One session is a data point, not a trend.
  if (recent.length < 2) return hold('insufficient_history');

  // 6. Somewhere in the middle: keep the weight, chase the reps.
  return hold('building');
}
