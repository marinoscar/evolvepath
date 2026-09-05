// =============================================================================
// When is a completion worth mentioning? (issue #59, epic E12)
// =============================================================================
//
// PRD §60's N7 is the only coaching category that interrupts with GOOD news,
// and that makes it the easiest one to get wrong in the direction of noise. A
// notification after every completed session would train the user to dismiss
// the whole channel within a week, and the dismissals would then reduce the
// reminders that actually help.
//
// So a milestone is a fact about a PATTERN, never about a single session:
// "third time in eight days" is information the user did not have, "you
// completed a workout" is information they were present for.
//
// Pure, so the boundaries are testable: the realistic bug is off-by-one at the
// window edge, where a milestone either fires twice or never.

export type EvidenceMilestone =
  | 'THIRD_IN_8_DAYS'
  | 'FIFTH_IN_14_DAYS'
  | 'TENTH_TOTAL'
  | 'FIRST_FULL_WEEK';

export interface MilestoneInput {
  /**
   * Completion instants for the SAME outcome, newest first, including the one
   * that just happened. The caller bounds this; nothing here reads a clock.
   */
  completions: Date[];
  now: Date;
  /** Total completions for the outcome, all time, including this one. */
  totalCompletions: number;
  /** Commitments planned for this outcome in the current Monday-start week. */
  weekPlanned?: number;
  /** How many of those are completed, including this one. */
  weekCompleted?: number;
}

const DAY_MS = 24 * 3600_000;

function countWithin(completions: Date[], now: Date, days: number): number {
  const cutoff = now.getTime() - days * DAY_MS;
  return completions.filter((at) => at.getTime() >= cutoff).length;
}

/**
 * The milestone this completion just reached, or `null`.
 *
 * EXACT equality on the counts, never `>=`. A `>=` would re-fire on the fourth,
 * fifth and sixth session in eight days, which is the noise this file exists to
 * avoid; the count crossing the line is the event, not the count being above it.
 *
 * Ordered strongest-first so a session that is simultaneously a tenth and a
 * third reports the rarer fact.
 */
export function evidenceMilestone(input: MilestoneInput): EvidenceMilestone | null {
  const { completions, now, totalCompletions, weekPlanned, weekCompleted } = input;

  if (totalCompletions === 10) return 'TENTH_TOTAL';

  if (
    weekPlanned !== undefined &&
    weekCompleted !== undefined &&
    weekPlanned > 0 &&
    weekCompleted === weekPlanned
  ) {
    return 'FIRST_FULL_WEEK';
  }

  if (countWithin(completions, now, 14) === 5) return 'FIFTH_IN_14_DAYS';
  if (countWithin(completions, now, 8) === 3) return 'THIRD_IN_8_DAYS';

  return null;
}

/** The window each milestone talks about, for the copy. */
export const MILESTONE_WINDOW_DAYS: Record<EvidenceMilestone, number> = {
  THIRD_IN_8_DAYS: 8,
  FIFTH_IN_14_DAYS: 14,
  TENTH_TOTAL: 0,
  FIRST_FULL_WEEK: 7,
};

/** The count the copy quotes for each milestone. */
export function milestoneCount(
  milestone: EvidenceMilestone,
  input: MilestoneInput,
): number {
  switch (milestone) {
    case 'TENTH_TOTAL':
      return input.totalCompletions;
    case 'FIFTH_IN_14_DAYS':
      return countWithin(input.completions, input.now, 14);
    case 'THIRD_IN_8_DAYS':
      return countWithin(input.completions, input.now, 8);
    case 'FIRST_FULL_WEEK':
      return input.weekCompleted ?? 0;
  }
}
