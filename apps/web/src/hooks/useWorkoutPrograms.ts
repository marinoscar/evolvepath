import { useCallback, useEffect, useState } from 'react';

import type {
  ApproveProgramResult,
  GenerateProgramRequest,
  GenerateProgramResult,
  WorkoutProgramSummary,
} from '../types';
import {
  approveWorkoutProgram,
  archiveWorkoutProgram,
  deleteWorkoutProgram,
  generateWorkoutProgram,
  listWorkoutPrograms,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseWorkoutProgramsResult {
  programs: WorkoutProgramSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  generate: (body: GenerateProgramRequest) => Promise<GenerateProgramResult>;
  approve: (
    id: string,
    body: { preferredTime?: string; startDate?: string },
  ) => Promise<ApproveProgramResult>;
  archive: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * The list, and the four things you can do to it.
 *
 * `generate` deliberately does NOT refetch. A generated program is a DRAFT the
 * user has not agreed to yet (PRD §15), and putting it in the list before they
 * have read it would make the list say something the user has not decided.
 * `approve`, `archive` and `remove` all refetch, because each of those is the
 * decision.
 */
export function useWorkoutPrograms(): UseWorkoutProgramsResult {
  const [programs, setPrograms] = useState<WorkoutProgramSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listWorkoutPrograms();
      if (isMounted()) setPrograms(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load your programs';
      if (isMounted()) {
        setError(message);
        setPrograms([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = useCallback(
    async (body: GenerateProgramRequest) => generateWorkoutProgram(body),
    [],
  );

  const approve = useCallback(
    async (id: string, body: { preferredTime?: string; startDate?: string }) => {
      const result = await approveWorkoutProgram(id, body);
      await refresh();
      return result;
    },
    [refresh],
  );

  const archive = useCallback(
    async (id: string) => {
      await archiveWorkoutProgram(id);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteWorkoutProgram(id);
      await refresh();
    },
    [refresh],
  );

  return { programs, isLoading, error, refresh, generate, approve, archive, remove };
}
