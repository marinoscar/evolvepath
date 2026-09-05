import type { CoachReply } from './contracts/coach-reply.contract';

// =============================================================================
// The hallucination guard (issue #70, epic E06)
// =============================================================================
//
// PRD §90 lists the failures this exists for by name: a fabricated completion,
// an incorrect active plan, an invented schedule conflict. §18 and §107 say the
// coach must reference the user's real state and never invent one.
//
// THE PROMPT ASKS; THIS ENFORCES. Both, and they are not redundant. A prompt is
// a request a model may decline under pressure — an ambiguous question, an
// unusual context, a new model version — and the failure it produces is the
// most damaging one this product has: a confident, specific, plausible
// sentence about something that did not happen. A user cannot tell that apart
// from a true one, which is exactly why it cannot be left to review.
//
// Pure, and id-only. It does not read the message text: judging prose is what
// the model was for, and a guard that tried would be a second unreliable
// classifier in front of the first.
// =============================================================================

export interface CoachOutputFacts {
  /** Commitment ids the coach was actually shown, plus the user's PLANNED rows. */
  commitmentIds: Set<string>;
  /** Plan ids in the context, mapped to the routine ids of their active version. */
  routineIdsByPlan: Map<string, Set<string>>;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function guardCoachOutput(
  reply: CoachReply,
  facts: CoachOutputFacts,
): GuardResult {
  const commitmentId = reply.recommended_action?.commitmentId;

  if (commitmentId && !facts.commitmentIds.has(commitmentId)) {
    return {
      ok: false,
      reason: `recommended_action.commitmentId ${commitmentId} is not a commitment of this user`,
    };
  }

  if (reply.proposal && reply.friction_question) {
    // Both would ask the user two different questions in one reply, and the UI
    // has one place to answer. Rejecting is better than picking one for them.
    return {
      ok: false,
      reason: 'a reply carries both a proposal and a friction question',
    };
  }

  if (reply.proposal) {
    const routineIds = facts.routineIdsByPlan.get(reply.proposal.planId);

    if (!routineIds) {
      return {
        ok: false,
        reason: `proposal.planId ${reply.proposal.planId} is not an active plan of this user`,
      };
    }

    for (const [index, change] of reply.proposal.changes.entries()) {
      const targetId = change.target.id;
      if (targetId === null) continue; // `add` has nothing to point at yet.

      // A routine id from ANOTHER of the user's plans is the subtle case:
      // ownership passes, and the change would land on the wrong plan.
      const known =
        routineIds.has(targetId) || facts.commitmentIds.has(targetId);

      if (!known) {
        return {
          ok: false,
          reason: `proposal.changes[${index}].target.id ${targetId} does not belong to plan ${reply.proposal.planId}`,
        };
      }
    }
  }

  return { ok: true };
}
