import { useCallback, useState } from 'react';

import type { PlanChange, ProposalSummary } from '../types';
import { acceptProposal, editProposal, rejectProposal } from '../services/api';

export interface ProposalOutcome {
  status: ProposalSummary['status'];
  /** The version an acceptance produced, for the "Plan updated (v2)" chip. */
  version?: number;
}

interface UseProposalsResult {
  /** Keyed by proposal id. Only proposals decided in this session appear. */
  outcomes: Record<string, ProposalOutcome>;
  pendingId: string | null;
  error: string | null;
  accept: (id: string) => Promise<void>;
  edit: (id: string, changes: PlanChange[]) => Promise<void>;
  reject: (id: string, reason?: string) => Promise<void>;
}

/**
 * Deciding a proposal, without refetching the whole thread.
 *
 * The decision is held HERE rather than written back into the message list,
 * because the proposal lives inside a message's `structured` blob: patching it
 * in place would mean two representations of one status, and the one in the
 * blob would be the stale one on the next refetch.
 */
export function useProposals(): UseProposalsResult {
  const [outcomes, setOutcomes] = useState<Record<string, ProposalOutcome>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (id: string, work: () => Promise<ProposalOutcome>) => {
      setPendingId(id);
      setError(null);
      try {
        const outcome = await work();
        setOutcomes((current) => ({ ...current, [id]: outcome }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update the plan');
        throw err;
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  const accept = useCallback(
    async (id: string) =>
      run(id, async () => {
        const result = await acceptProposal(id);
        return { status: 'ACCEPTED' as const, version: result.planVersion.version };
      }),
    [run],
  );

  const edit = useCallback(
    async (id: string, changes: PlanChange[]) =>
      run(id, async () => {
        // Edit then accept: the dialog exists so the user can agree to a
        // changed version of the proposal, not so they can save a draft.
        await editProposal(id, changes);
        const result = await acceptProposal(id);
        return { status: 'ACCEPTED' as const, version: result.planVersion.version };
      }),
    [run],
  );

  const reject = useCallback(
    async (id: string, reason?: string) =>
      run(id, async () => {
        await rejectProposal(id, reason);
        return { status: 'REJECTED' as const };
      }),
    [run],
  );

  return { outcomes, pendingId, error, accept, edit, reject };
}
