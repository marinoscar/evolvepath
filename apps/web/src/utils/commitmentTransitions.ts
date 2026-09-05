import type { CommitmentStatus } from '../types';

// =============================================================================
// A VERBATIM COPY of the API's commitment transition matrix (#56, epic #33)
// =============================================================================
//
// THE ORIGINAL IS `apps/api/src/commitments/commitment-transitions.ts`, and
// that file points back at this one. The table below must stay byte-equivalent
// to it; the rationale for each edge is written out there and is not repeated.
//
// WHY A COPY AT ALL, given that every `Commitment` the API returns already
// carries its own `allowedTransitions`:
//
//   * The SERVER'S answer is authoritative and is what every menu renders. A
//     client running yesterday's bundle therefore cannot offer a move the API
//     refuses — the list came from the API that would refuse it.
//   * This copy is for OPTIMISTIC rendering only: after a transition succeeds
//     the UI knows the new status before the refetch lands, and it needs to
//     redraw the menu for that status without a round trip. Reaching for
//     `commitment.allowedTransitions` there would show the PREVIOUS status's
//     options for one frame.
//
// So: `commitment.allowedTransitions` wherever a commitment is in hand,
// `allowedTransitions()` only where one is being predicted.
// =============================================================================

/** Statuses with no exits: the commitment's story is over. */
export const TERMINAL_STATUSES: ReadonlySet<CommitmentStatus> = new Set<CommitmentStatus>([
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'RESCHEDULED',
  'SKIPPED',
  'MISSED',
  'CANCELLED',
]);

const ALLOWED: Record<CommitmentStatus, readonly CommitmentStatus[]> = {
  PLANNED: ['READY', 'STARTED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED'],
  READY: ['PLANNED', 'STARTED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED'],
  STARTED: ['COMPLETED', 'PARTIALLY_COMPLETED', 'RESCHEDULED', 'SKIPPED', 'CANCELLED'],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  RESCHEDULED: [],
  SKIPPED: [],
  MISSED: [],
  CANCELLED: [],
};

export function canTransition(from: CommitmentStatus, to: CommitmentStatus): boolean {
  return from !== to && ALLOWED[from].includes(to);
}

export function allowedTransitions(from: CommitmentStatus): readonly CommitmentStatus[] {
  return ALLOWED[from];
}

/** The verb the user reads on the menu, per target status. */
export const TRANSITION_LABELS: Record<CommitmentStatus, string> = {
  PLANNED: 'Move back to planned',
  READY: 'Ready',
  STARTED: 'Start',
  COMPLETED: 'Complete',
  PARTIALLY_COMPLETED: 'Partially complete',
  RESCHEDULED: 'Reschedule',
  SKIPPED: 'Skip',
  MISSED: 'Missed',
  CANCELLED: 'Cancel',
};

/**
 * The word on the chip. Never colour alone (PRD §122) — a status a user cannot
 * distinguish is a status they cannot act on.
 */
export const STATUS_LABELS: Record<CommitmentStatus, string> = {
  PLANNED: 'Planned',
  READY: 'Ready',
  STARTED: 'Started',
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially completed',
  RESCHEDULED: 'Rescheduled',
  SKIPPED: 'Skipped',
  MISSED: 'Missed',
  CANCELLED: 'Cancelled',
};

/** MUI chip colours. Decoration on top of the word above, never instead of it. */
export const STATUS_COLORS: Record<
  CommitmentStatus,
  'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
> = {
  PLANNED: 'default',
  READY: 'info',
  STARTED: 'primary',
  COMPLETED: 'success',
  PARTIALLY_COMPLETED: 'success',
  RESCHEDULED: 'warning',
  SKIPPED: 'warning',
  MISSED: 'error',
  CANCELLED: 'default',
};
