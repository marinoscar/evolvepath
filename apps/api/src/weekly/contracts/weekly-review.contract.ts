import type { CoachContext } from '../../coach/context/context.types';
import {
  weeklyReviewOutputSchema,
  type WeeklyReviewOutput,
} from '../weekly.schema';

// =============================================================================
// What the reviewer is allowed to have said (issue #73, epic E10)
// =============================================================================
//
// The prompt ASKS the model to name only ids it was given; this guard ENFORCES
// it, and the two are not redundant (PRD §90). A reviewer that proposes moving
// a routine the user does not have produces a confident, specific, entirely
// plausible sentence — and the diff the user is shown would be a diff of
// nothing. Worse, `ProposalsService.createFromSource` would answer 422 for a
// plan id that is not theirs, so the failure mode without this guard is an
// exception in the middle of a generation rather than a dropped proposal.
//
// The guard NEVER THROWS. A hallucinated proposal is a reason to drop that
// proposal, not to fail a review whose numbers are correct and whose other five
// outputs are useful.
// =============================================================================

export const WEEKLY_REVIEW_SCHEMA_NAME = 'weekly_review';

export const weeklyReviewContractSchema = weeklyReviewOutputSchema;

export interface AllowedIds {
  planIds: Set<string>;
  routineIds: Set<string>;
  commitmentIds: Set<string>;
}

export interface GuardResult {
  output: WeeklyReviewOutput;
  /** How many `proposedChanges` entries were removed. Recorded in the audit. */
  dropped: number;
}

/** Every id the context actually contained, as the guard's allow-list. */
export function allowedIdsFrom(context: CoachContext): AllowedIds {
  return {
    planIds: new Set(context.activePlans.map((plan) => plan.planId)),
    routineIds: new Set(
      context.activePlans.flatMap((plan) => plan.routines.map((r) => r.routineId)),
    ),
    commitmentIds: new Set(
      [...context.todayCommitments, ...context.recentMisses].map((c) => c.commitmentId),
    ),
  };
}

/**
 * Drop every proposed change that names something the user does not have.
 *
 * An `add` op is kept with a null target — it has nothing to point at yet, by
 * E06-04's own schema, and refusing those would mean the reviewer could never
 * suggest a new routine.
 */
export function guardReviewOutput(
  output: WeeklyReviewOutput,
  allowed: AllowedIds,
): GuardResult {
  const kept = output.proposedChanges.filter((proposal) => {
    if (!allowed.planIds.has(proposal.planId)) return false;

    return proposal.changes.every((change) => {
      if (change.target.id === null) return true;

      return change.target.type === 'routine'
        ? allowed.routineIds.has(change.target.id)
        : allowed.commitmentIds.has(change.target.id);
    });
  });

  return {
    output: { ...output, proposedChanges: kept },
    dropped: output.proposedChanges.length - kept.length,
  };
}
