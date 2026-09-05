import { useCallback, useEffect, useState } from 'react';

import type {
  Outcome,
  Plan,
  PlanInput,
  PlanVersion,
  PlanVersionInput,
  PlanVersionSummary,
  Routine,
  RoutineInput,
} from '../types';
import {
  activatePlanVersion,
  archiveOutcome,
  createPlan,
  createPlanVersion,
  createRoutine,
  deleteRoutine,
  getOutcome,
  getPlanVersions,
  getPlansForOutcome,
  getRoutines,
  rejectPlanVersion,
  updateOutcome,
  updateRoutine,
} from '../services/api';
import { ApiError } from '../services/api';
import { useIsMounted } from './useIsMounted';
import type { OutcomeInput } from '../types';

interface UseOutcomeResult {
  outcome: Outcome | null;
  plan: Plan | null;
  versions: PlanVersionSummary[];
  /** The routines of the ACTIVE version, or of the sole draft when none is active. */
  routines: Routine[];
  /** The version those routines belong to — what the editors write into. */
  editableVersion: PlanVersionSummary | null;
  isLoading: boolean;
  /** True when the API answered 404: unknown OR not the caller's. */
  notFound: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateOutcomeFields: (patch: OutcomeInput) => Promise<Outcome>;
  archive: () => Promise<Outcome>;
  addPlan: (input: PlanInput) => Promise<Plan>;
  addVersion: (input: PlanVersionInput) => Promise<PlanVersion>;
  activateVersion: (version: number) => Promise<PlanVersion>;
  rejectVersion: (version: number) => Promise<PlanVersion>;
  addRoutine: (input: RoutineInput) => Promise<Routine>;
  editRoutine: (id: string, patch: RoutineInput) => Promise<Routine>;
  removeRoutine: (id: string) => Promise<void>;
}

/**
 * Everything the outcome detail page needs, behind ONE `refresh`.
 *
 * The four requests (outcome, plans, versions, routines) are chained rather
 * than parallel because each depends on the last: there is no plan id until
 * the outcome is loaded, and no version id until the plan is. Only the last
 * two could overlap, and saving one round trip is not worth two code paths.
 *
 * The routines fetched are the EDITABLE version's — the active one, or the
 * sole draft when nothing is active yet. A superseded version's routines are
 * loaded on demand by the history component, which shows them read-only.
 */
export function useOutcome(id: string | undefined): UseOutcomeResult {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [versions, setVersions] = useState<PlanVersionSummary[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [editableVersion, setEditableVersion] = useState<PlanVersionSummary | null>(null);
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
      const loadedOutcome = await getOutcome(id);
      const plans = await getPlansForOutcome(id);
      const loadedPlan = plans[0] ?? null;

      const loadedVersions = loadedPlan ? await getPlanVersions(loadedPlan.id) : [];
      const editable =
        loadedVersions.find((version) => version.status === 'ACTIVE') ??
        loadedVersions.find((version) => version.status === 'DRAFT') ??
        null;
      const loadedRoutines = editable ? await getRoutines(editable.id) : [];

      if (!isMounted()) return;

      setOutcome(loadedOutcome);
      setPlan(loadedPlan);
      setVersions(loadedVersions);
      setEditableVersion(editable);
      setRoutines(loadedRoutines);
    } catch (err) {
      if (!isMounted()) return;

      // 404 is its own state, not an error banner. The API answers it for an
      // id that never existed AND for one belonging to someone else — the two
      // are deliberately indistinguishable — so the page shows "not found"
      // rather than anything that would confirm the difference.
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        setOutcome(null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load the outcome');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [id, isMounted]);

  /** Every mutation refreshes: a plan change moves versions, routines and chips at once. */
  function mutation<Args extends unknown[], Result>(
    run: (...args: Args) => Promise<Result>,
    failureMessage: string,
  ) {
    return async (...args: Args): Promise<Result> => {
      setError(null);
      try {
        const result = await run(...args);
        await refresh();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : failureMessage;
        if (isMounted()) setError(message);
        throw err;
      }
    };
  }

  const updateOutcomeFields = useCallback(
    mutation(
      (patch: OutcomeInput) => updateOutcome(id as string, patch),
      'Failed to update the outcome',
    ),
    [id, refresh],
  );

  const archive = useCallback(
    mutation(() => archiveOutcome(id as string), 'Failed to archive the outcome'),
    [id, refresh],
  );

  const addPlan = useCallback(
    mutation((input: PlanInput) => createPlan(id as string, input), 'Failed to create the plan'),
    [id, refresh],
  );

  const addVersion = useCallback(
    mutation(
      (input: PlanVersionInput) => createPlanVersion(plan?.id as string, input),
      'Failed to create the version',
    ),
    [plan?.id, refresh],
  );

  const activateVersion = useCallback(
    mutation(
      (version: number) => activatePlanVersion(plan?.id as string, version),
      'Failed to activate the version',
    ),
    [plan?.id, refresh],
  );

  const rejectVersion = useCallback(
    mutation(
      (version: number) => rejectPlanVersion(plan?.id as string, version),
      'Failed to reject the version',
    ),
    [plan?.id, refresh],
  );

  const addRoutine = useCallback(
    mutation(
      (input: RoutineInput) =>
        createRoutine({ ...input, planVersionId: editableVersion?.id as string }),
      'Failed to add the routine',
    ),
    [editableVersion?.id, refresh],
  );

  const editRoutine = useCallback(
    mutation(
      (routineId: string, patch: RoutineInput) => updateRoutine(routineId, patch),
      'Failed to update the routine',
    ),
    [refresh],
  );

  const removeRoutine = useCallback(
    mutation((routineId: string) => deleteRoutine(routineId), 'Failed to delete the routine'),
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    outcome,
    plan,
    versions,
    routines,
    editableVersion,
    isLoading,
    notFound,
    error,
    refresh,
    updateOutcomeFields,
    archive,
    addPlan,
    addVersion,
    activateVersion,
    rejectVersion,
    addRoutine,
    editRoutine,
    removeRoutine,
  };
}
