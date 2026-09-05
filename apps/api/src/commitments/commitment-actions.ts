import type { CommitmentStatus } from '@prisma/client';

import { allowedTransitions, TERMINAL_STATUSES } from './commitment-transitions';

// =============================================================================
// Intent-named actions over the status matrix (issue #40, epic E05)
// =============================================================================
//
// PURE, and shaped like `commitment-transitions.ts` next door, because the same
// two consumers need it: the API computes `availableActions` on every card, and
// the web app renders exactly that list rather than a locally reasoned one.
//
// WHY A SECOND VOCABULARY AT ALL. The matrix answers "which STATUS may follow
// this one". A screen asks something narrower: "which BUTTON should I show".
// Those differ in three ways that a status list cannot express:
//
//   * `pause` and `continue` are not transitions. Both leave the commitment
//     STARTED; what changes is whether the timer is running. Paused is
//     `STARTED` with `activeSince: null` (PRD §10.7 owns the status enum and
//     there is no PAUSED member in it).
//   * `start` and `continue` are the same button to a user and different
//     operations to the server, decided by `activeSince`.
//   * `decompose` and `fallback` change no status at all.
//
// So this module maps a row to buttons, and defers to the matrix for every
// action that IS a status change.
// =============================================================================

export const COMMITMENT_ACTIONS = [
  'start',
  'pause',
  'continue',
  'complete',
  'partial',
  'fallback',
  'reschedule',
  'skip',
  'decompose',
] as const;

export type CommitmentAction = (typeof COMMITMENT_ACTIONS)[number];

/** The subset of a commitment this decision depends on. */
export interface ActionableCommitment {
  status: CommitmentStatus;
  activeSince: Date | null;
}

/**
 * The actions the API will accept for this row, in the order a screen shows
 * them (the primary move first).
 *
 * A terminal commitment offers nothing: PRD §103 keeps it as history and an
 * "undo" would make evidence untrustworthy.
 */
export function availableActionsFor(commitment: ActionableCommitment): CommitmentAction[] {
  const { status, activeSince } = commitment;

  if (TERMINAL_STATUSES.has(status)) return [];

  const canReach = (to: CommitmentStatus): boolean => allowedTransitions(status).includes(to);
  const actions: CommitmentAction[] = [];

  if (status === 'STARTED') {
    // One button, two operations. Which one it is depends on the timer, not on
    // the status, which is exactly why this cannot be derived from the matrix.
    actions.push(activeSince ? 'pause' : 'continue');
  } else if (canReach('STARTED')) {
    actions.push('start');
  }

  if (canReach('COMPLETED')) actions.push('complete');
  if (canReach('PARTIALLY_COMPLETED')) actions.push('partial');

  // No status change; offered whenever the commitment is still open.
  actions.push('fallback');

  // A started commitment cannot be moved: its evidence belongs to today, and
  // carrying it to tomorrow would carry that evidence with it.
  if (canReach('RESCHEDULED') && status !== 'STARTED') actions.push('reschedule');

  if (canReach('SKIPPED')) actions.push('skip');

  actions.push('decompose');

  return actions;
}

/** Whether this row will accept this action, without performing it. */
export function isActionAvailable(
  commitment: ActionableCommitment,
  action: CommitmentAction,
): boolean {
  return availableActionsFor(commitment).includes(action);
}
