import { useCallback, useEffect, useState } from 'react';

import type { ProposalSummary, WorkoutProgram } from '../types';
import { archiveWorkoutProgram, getProposals, getWorkoutProgram } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseWorkoutProgramResult {
  program: WorkoutProgram | null;
  /** Open WORKOUT proposals against this user's plan (E09-05). */
  proposals: ProposalSummary[];
  isLoading: boolean;
  /** True for an id that is not there — or is not yours, which answers the same. */
  notFound: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  archive: () => Promise<void>;
}

/**
 * One program, plus whether the coach has suggested changing it.
 *
 * A 404 becomes a NOT-FOUND STATE rather than a redirect. The API answers 404
 * for a foreign id exactly as it does for one that never existed, and
 * redirecting would make a mistyped URL look like a working one.
 */
export function useWorkoutProgram(id: string | undefined): UseWorkoutProgramResult {
  const [program, setProgram] = useState<WorkoutProgram | null>(null);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const result = await getWorkoutProgram(id);
      if (isMounted()) setProgram(result);

      // A failure here costs a badge, not the page.
      try {
        const open = await getProposals({ status: 'PROPOSED', sourceKind: 'WORKOUT' });
        if (isMounted()) setProposals(open);
      } catch {
        if (isMounted()) setProposals([]);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;

      if (isMounted()) {
        setProgram(null);
        if (status === 404) setNotFound(true);
        else setError(err instanceof Error ? err.message : 'Failed to load the program');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [id, isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const archive = useCallback(async () => {
    if (!id) return;
    await archiveWorkoutProgram(id);
    await refresh();
  }, [id, refresh]);

  return { program, proposals, isLoading, notFound, error, refresh, archive };
}
