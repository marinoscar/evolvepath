import type { PlanChange, ProposalDetail } from '../../types';
import type { ProposalOutcome } from '../../hooks/useProposals';
import ProposalCard from '../coach/ProposalCard';

/**
 * A weekly review's recommendation, rendered by the SAME card the coach uses.
 *
 * E06-07's `ProposalCard` already owns the three buttons PRD §15 fixes
 * (Accept / Edit / Keep current plan) and the `PlanChangeDiff` table beneath
 * them. Forking it here would mean two renderings of a plan change, and the day
 * they diverged the user would be agreeing to whichever one they happened to be
 * looking at.
 *
 * The only work this wrapper does is shape translation: the coach passes a
 * proposal out of a message's `structured` blob, and the review has a resolved
 * `ProposalDetail` with the diff the API already computed.
 */
export default function ReviewProposalCard({
  proposal,
  outcome,
  busy,
  onAccept,
  onEdit,
  onReject,
}: {
  proposal: ProposalDetail;
  outcome?: ProposalOutcome;
  busy?: boolean;
  onAccept: (id: string) => void;
  onEdit: (id: string, changes: PlanChange[]) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div data-testid="review-proposal">
      <ProposalCard
        proposal={{
          kind: 'plan_change',
          planId: proposal.planId,
          proposalId: proposal.id,
          summary: proposal.summary,
          changes: proposal.changes,
        }}
        outcome={outcome}
        // The API's own preview, not a client-side re-derivation: the diff the
        // user reads has to be the one accepting would apply.
        diff={proposal.preview.diff}
        domainLabel={proposal.plan.outcomeTitle}
        busy={busy}
        onAccept={onAccept}
        onEdit={onEdit}
        onReject={onReject}
      />
    </div>
  );
}
