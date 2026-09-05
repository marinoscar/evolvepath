// =============================================================================
// Automatic reduction when the coach is being ignored (issue #59, epic E12)
// =============================================================================
//
// PRD §61: "automatic reduction if ignored repeatedly". The product reading is
// stronger than the sentence — VISION §38 wants the coach to need itself less
// over time, and a user who stops responding is telling it something. The
// correct answer to being ignored is to say less, not to say the same amount
// louder.
//
// WHY HALVING, AND WHY FIVE.
//
// Both numbers are judgement, and both are here rather than in the caller so
// that changing either is one edit with one test to update. Five is roughly a
// day and a half of a default four-a-day cap: long enough that a busy Tuesday
// does not trip it, short enough that a week of silence does not go unnoticed.
// Halving rather than muting is deliberate — going to zero would remove the
// only mechanism that could earn the attention back, and the user has not asked
// to be left alone (there is a setting for that, and `mutedCategories` is it).
//
// RECOVERY IS ONE ACTION, not a decay curve. `history()` counts only since the
// last ACTIONED row, so acting on a single notification clears the streak
// outright. A gradual restoration would mean a user who came back still got a
// reduced service for days, which punishes exactly the behaviour being asked
// for.

/** Consecutive ignored messages before the daily cap is reduced. */
export const FATIGUE_THRESHOLD = 5;

export interface FatigueAssessment {
  active: boolean;
  effectiveDailyCap: number;
}

export function assessFatigue(
  consecutiveIgnored: number,
  dailyCap: number,
): FatigueAssessment {
  const active = consecutiveIgnored >= FATIGUE_THRESHOLD;
  return {
    active,
    // `ceil`, not `floor`: a cap of 1 halves to 1, not to 0. Fatigue reduces
    // the coach's volume; only the user silences it.
    effectiveDailyCap: active ? Math.ceil(dailyCap / 2) : dailyCap,
  };
}
