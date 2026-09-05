import type { CommitmentStatus } from '@prisma/client';

// =============================================================================
// The commitment state machine (issue #47, epic #33)
// =============================================================================
//
// DELIBERATELY FREE OF NEST IMPORTS. This file is a pure data structure plus
// two pure functions, for two reasons:
//
//   1. It can be exhaustively unit-tested over all 81 pairs, which is the only
//      way to be sure a matrix is what it claims to be. A sampled test proves
//      the cases someone thought of.
//   2. The web app needs the same matrix to decide which buttons to offer, and
//      a UI that offers a transition the API refuses is a bug the user sees.
//      `apps/web/src/utils/commitmentTransitions.ts` (#56) is a copy of the
//      table below and must agree with it; each file points at the other.
//
// THE THREE DESIGN DECISIONS IN THE TABLE:
//
//   * STARTED is reachable from PLANNED directly, not only through READY.
//     PRD P4 ("start matters") wants the start recorded whenever it happens;
//     forcing a READY step first would mean the product either invents one or
//     loses the fact that the user started.
//   * Everything past STARTED is TERMINAL. A completed commitment does not go
//     back to started, and a skipped one does not become completed later — the
//     honest record of a day is what the user did, and an "undo" would make
//     evidence (PRD §10.9) untrustworthy. To change your mind, create a new
//     commitment; the old one stays as history (PRD §103).
//   * MISSED is not reachable from STARTED. Something you started and did not
//     finish is PARTIALLY_COMPLETED or SKIPPED, both of which the user chooses.
//     MISSED is for a commitment whose time passed untouched — E11's comeback
//     loop sets it; nothing in E02 changes a status without a user request.
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
  // No READY here on purpose: "pause and resume" is E05-02's decomposition
  // flow, not a status change, and adding it silently would let a started
  // commitment lose its startedAt semantics.
  STARTED: ['COMPLETED', 'PARTIALLY_COMPLETED', 'RESCHEDULED', 'SKIPPED', 'CANCELLED'],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  RESCHEDULED: [],
  SKIPPED: [],
  MISSED: [],
  CANCELLED: [],
};

/**
 * `from === to` is always false, even where it would otherwise be listed.
 * Re-applying a status is not a transition, and treating it as one would make
 * a double-tapped button write a second audit row and move `startedAt`.
 */
export function canTransition(from: CommitmentStatus, to: CommitmentStatus): boolean {
  return from !== to && ALLOWED[from].includes(to);
}

/** What the UI should offer for a commitment in this status. */
export function allowedTransitions(from: CommitmentStatus): readonly CommitmentStatus[] {
  return ALLOWED[from];
}
