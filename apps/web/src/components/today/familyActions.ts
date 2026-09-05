import type { CommitmentCard } from '../../types';
import {
  FAMILY_ACTION_LABELS,
  FAMILY_COMPLETED_LABEL,
  type FamilyRowAction,
} from '../family/familyLabels';
import { ACTION_LABELS, type RowAction } from './todayLabels';

// ===========================================================================
// Family words over the generic lifecycle (epic E08, issue #50)
// ===========================================================================
//
// LABELS ONLY. Every action a family row offers is one the API already allows,
// posted to the endpoint the generic row would post to, and decided by the
// server's `availableActions`. Nothing here computes what is permitted; if it
// did, a bundle running yesterday's rules would offer a move the API refuses.
//
// The words matter because the register does. "Reschedule" is what you do to a
// meeting; "Move it" is what you do to dinner with your family. A product that
// says the first about the second sounds like a calendar.
//
// `ready` is the one action not in `availableActions`: it is
// `POST /commitments/:id/transition { to: 'READY' }` rather than an action
// endpoint, so it is offered here for a PLANNED family row — the "I'm in" that
// PRD §105 asks for — and never expected back from the server.
// ===========================================================================

/** Whether this commitment should speak in family words. */
export function isFamilyOccurrence(commitment: CommitmentCard): boolean {
  return commitment.domain === 'FAMILY';
}

/**
 * The row's actions, in order, with `ready` prepended where it applies.
 *
 * `PLANNED` and `RESCHEDULED` are the two statuses where "I'm in" means
 * something. A `RESCHEDULED` row is closed, so it never has one in practice —
 * it is listed because PRD §105 names both and the matrix, not this list, is
 * what actually decides.
 */
export function familyRowActions(commitment: CommitmentCard): FamilyRowAction[] {
  const base = commitment.availableActions as FamilyRowAction[];

  if (!isFamilyOccurrence(commitment) || commitment.status !== 'PLANNED') return base;

  return ['ready', ...base];
}

/** The label for one action on one row. Family words first, generic after. */
export function familyActionLabel(action: FamilyRowAction): string {
  return FAMILY_ACTION_LABELS[action] ?? ACTION_LABELS[action as RowAction] ?? action;
}

/** How a finished family commitment reads: "Kept", not "Done". */
export function familyStatusLabel(commitment: CommitmentCard): string | null {
  return isFamilyOccurrence(commitment) && commitment.status === 'COMPLETED'
    ? FAMILY_COMPLETED_LABEL
    : null;
}
