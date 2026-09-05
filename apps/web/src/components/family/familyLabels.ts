import type { FamilyRelationship } from '../../types';
import type { RowAction } from '../today/todayLabels';

// ===========================================================================
// The words the Family surface uses (epic E08, issue #50)
// ===========================================================================
//
// FAMILY ACTION LABELS ARE LABELS AND NOTHING ELSE. Every one of them posts to
// the same endpoint the generic Today row posts to, and the API's matrix
// decides what is allowed. "I'm in" is `transition → READY`; "Move it" is the
// reschedule action; "Skip today" is the skip action. Renaming a verb is a copy
// decision; it must never become a second lifecycle.
//
// The words matter because the register does. "Reschedule" is what you do to a
// meeting. "Move it" is what you do to dinner with your family, and a product
// that says the first about the second sounds like a calendar.
// ===========================================================================

export const RELATIONSHIP_LABELS: Record<FamilyRelationship, string> = {
  PARTNER: 'Partner',
  CHILD: 'Child',
  PARENT: 'Parent',
  SIBLING: 'Sibling',
  FRIEND: 'Friend',
  OTHER: 'Other',
};

/** The select's order, matching the API enum so nothing has to be re-sorted. */
export const RELATIONSHIPS: FamilyRelationship[] = [
  'PARTNER',
  'CHILD',
  'PARENT',
  'SIBLING',
  'FRIEND',
  'OTHER',
];

/**
 * `ready` is not one of the API's action endpoints — it is
 * `POST /commitments/:id/transition { to: 'READY' }`, the same call the generic
 * row makes. It is listed here so a Family row can offer it as its primary
 * button when the commitment is still PLANNED.
 */
export type FamilyRowAction = RowAction | 'ready';

/**
 * Family words for the actions a ritual occurrence offers.
 *
 * Only the entries that differ are listed; everything else falls through to
 * `ACTION_LABELS`. Keeping the map sparse is what stops it from becoming a
 * second copy of the action vocabulary that drifts from the first.
 */
export const FAMILY_ACTION_LABELS: Partial<Record<FamilyRowAction, string>> = {
  ready: "I'm in",
  reschedule: 'Move it',
  skip: 'Skip today',
};

/** How a finished family commitment reads. "Done" is a task; this is not one. */
export const FAMILY_COMPLETED_LABEL = 'Kept';

export const FAMILY_EMPTY_HEADLINE = 'Protect what matters before the calendar takes it';

export const FAMILY_EMPTY_BODY =
  'Add the people you want time with, then describe the ritual you are protecting — ' +
  'the evenings, the calls, the Saturday mornings. Each one turns into real ' +
  'commitments you can keep, move or skip.';
