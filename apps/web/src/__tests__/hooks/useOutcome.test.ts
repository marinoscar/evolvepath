import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useOutcome } from '../../hooks/useOutcome';
import { getPathState, makeOutcome, seedPathState } from '../mocks/pathHandlers';

describe('useOutcome', () => {
  it('loads the outcome, its plan, its versions and the editable version\'s routines', async () => {
    const outcome = makeOutcome();
    seedPathState({
      outcomes: [outcome],
      plans: [
        {
          id: 'plan-1',
          outcomeId: outcome.id,
          activeVersion: null,
          versionCount: 1,
          createdAt: new Date().toISOString(),
        },
      ],
      versions: [
        {
          id: 'version-1',
          planId: 'plan-1',
          version: 1,
          status: 'ACTIVE',
          rationale: 'Start with mornings',
          expectedWeeklyLoad: null,
          fallbackStrategy: null,
          createdBy: 'USER',
          userApproved: true,
          previousVersionId: null,
          activeFrom: new Date().toISOString(),
          activeUntil: null,
          routineCount: 0,
          createdAt: new Date().toISOString(),
          routines: [],
        },
      ],
    });

    const { result } = renderHook(() => useOutcome(outcome.id));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.outcome?.id).toBe(outcome.id);
    expect(result.current.plan?.id).toBe('plan-1');
    expect(result.current.versions).toHaveLength(1);
    // The ACTIVE version is what the editors write into.
    expect(result.current.editableVersion?.id).toBe('version-1');
  });

  // A 404 is the API's answer for an unknown id AND for someone else's —
  // deliberately indistinguishable. It is its own state, not an error banner.
  it('reports notFound rather than an error for a 404', async () => {
    const { result } = renderHook(() => useOutcome('nope'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.outcome).toBeNull();
  });

  it('falls back to the sole draft when no version is active yet', async () => {
    const outcome = makeOutcome();
    seedPathState({
      outcomes: [outcome],
      plans: [
        {
          id: 'plan-1',
          outcomeId: outcome.id,
          activeVersion: null,
          versionCount: 1,
          createdAt: new Date().toISOString(),
        },
      ],
      versions: [
        {
          id: 'version-1',
          planId: 'plan-1',
          version: 1,
          status: 'DRAFT',
          rationale: null,
          expectedWeeklyLoad: null,
          fallbackStrategy: null,
          createdBy: 'USER',
          userApproved: false,
          previousVersionId: null,
          activeFrom: null,
          activeUntil: null,
          routineCount: 0,
          createdAt: new Date().toISOString(),
          routines: [],
        },
      ],
    });

    const { result } = renderHook(() => useOutcome(outcome.id));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.editableVersion?.status).toBe('DRAFT');
  });

  it('creates a plan and refreshes into it', async () => {
    const outcome = makeOutcome();
    seedPathState({ outcomes: [outcome] });

    const { result } = renderHook(() => useOutcome(outcome.id));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.plan).toBeNull();

    await act(async () => {
      await result.current.addPlan({ rationale: 'Start with mornings' });
    });

    await waitFor(() => expect(result.current.plan).not.toBeNull());
    // v1 arrives ACTIVE and approved.
    expect(result.current.versions[0].status).toBe('ACTIVE');
    expect(result.current.versions[0].userApproved).toBe(true);
    expect(getPathState().plans).toHaveLength(1);
  });
});
