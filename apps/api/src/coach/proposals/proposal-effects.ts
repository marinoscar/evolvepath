import type { Prisma, ProposalSourceKind } from '@prisma/client';

import type { PlanChange } from './plan-change.schema';

// =============================================================================
// Domain effects of accepting a proposal (issue #88, epic E09)
// =============================================================================
//
// `applyChanges` is pure and knows only about routines and commitments — that
// is what makes it the same function for the preview and the apply. But some
// proposals mean something in a domain table too: a workout proposal that
// reduces a routine's duration also has to change the template that routine
// schedules, and swap the exercise the user agreed to swap.
//
// A HOOK RATHER THAN A BRANCH IN `accept`. E06 must not grow a `case 'WORKOUT'`
// — the next domain would add a second one, and the mutation protocol would
// slowly become a switch statement over the product. The effect is a provider
// registered under a multi-token, matched on `sourceKind`, run INSIDE the accept
// transaction so a domain write that fails takes the plan version with it.
//
// An effect gets `tx` and facts, never the service. It cannot start its own
// transaction, cannot call back into `ProposalsService`, and cannot make the
// accept mean something the user did not read.
// =============================================================================

export const PROPOSAL_EFFECT = Symbol('PROPOSAL_EFFECT');

export interface ProposalEffectContext {
  userId: string;
  planId: string;
  /** The version this acceptance just made ACTIVE. */
  planVersionId: string;
  changes: PlanChange[];
}

export interface ProposalEffect {
  /** Which proposals this effect runs for. */
  readonly sourceKind: ProposalSourceKind;

  apply(tx: Prisma.TransactionClient, context: ProposalEffectContext): Promise<void>;
}
