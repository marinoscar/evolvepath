import { describe, it, expect } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '../utils/hook-utils';
import { getFamilyState, makeRitual, seedFamilyState } from '../mocks/familyHandlers';
import { getPathState } from '../mocks/pathHandlers';
import { RitualTitleError, useRituals } from '../../hooks/useRituals';

describe('useRituals', () => {
  it('loads the rituals on mount', async () => {
    seedFamilyState({ rituals: [makeRitual()] });

    const { result } = renderHookWithProviders(() => useRituals());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rituals).toHaveLength(1);
  });

  it('creates a ritual and materializes its occurrences', async () => {
    const { result } = renderHookWithProviders(() => useRituals());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.create({
      title: 'Phone-free dinner',
      // Every day, so an occurrence certainly falls inside the horizon
      // whatever day the suite happens to run on.
      recurrence: { weekdays: [0, 1, 2, 3, 4, 5, 6], time: '23:59', everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
    });

    await waitFor(() => expect(result.current.rituals).toHaveLength(1));

    const occurrences = getPathState().commitments.filter(
      (row) => row.ritualId === getFamilyState().rituals[0].id,
    );
    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences[0]).toMatchObject({ domain: 'FAMILY', status: 'PLANNED' });
  });

  // A lint refusal is a FIELD error, not a page error: the page is fine, one
  // sentence in the form is not.
  it('surfaces a lint refusal as a typed error carrying the match', async () => {
    const { result } = renderHookWithProviders(() => useRituals());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.create({
        title: 'Make Mia happier',
        recurrence: { weekdays: [1], time: '18:30', everyNWeeks: 1 },
        idealMinutes: 45,
        minimumMinutes: 10,
      }),
    ).rejects.toBeInstanceOf(RitualTitleError);

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('reports an ordinary failure as a page error', async () => {
    const { result } = renderHookWithProviders(() => useRituals());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.create({
        title: 'Phone-free dinner',
        recurrence: { weekdays: [1], time: '18:30', everyNWeeks: 1 },
        idealMinutes: 10,
        minimumMinutes: 45,
      }),
    ).rejects.toBeTruthy();

    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it('materializes idempotently: a repeat is skipped', async () => {
    const ritual = makeRitual({
      recurrence: { weekdays: [0, 1, 2, 3, 4, 5, 6], time: '23:59', everyNWeeks: 1 },
    });
    seedFamilyState({ rituals: [ritual] });

    const { result } = renderHookWithProviders(() => useRituals());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const first = await result.current.materialize(ritual.id);
    const second = await result.current.materialize(ritual.id);

    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(first.created);
  });

  it('removes a ritual and refetches', async () => {
    const ritual = makeRitual();
    seedFamilyState({ rituals: [ritual] });

    const { result } = renderHookWithProviders(() => useRituals());
    await waitFor(() => expect(result.current.rituals).toHaveLength(1));

    await result.current.remove(ritual.id);

    await waitFor(() => expect(result.current.rituals).toHaveLength(0));
  });
});
