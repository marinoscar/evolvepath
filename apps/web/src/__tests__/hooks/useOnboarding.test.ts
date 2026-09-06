import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from '../mocks/server';
import { useOnboarding } from '../../hooks/useOnboarding';
import { onboardingPatches, seedOnboardingState } from '../mocks/onboardingHandlers';

/**
 * The wizard's state (issue #102, epic E04).
 *
 * The interesting behaviour is the OPTIMISTIC ADVANCE and its revert: the step
 * moves before the PATCH lands so eight minutes do not become twelve, and a
 * failure has to put the user back where they were rather than one screen ahead
 * of what was saved.
 */
describe('useOnboarding', () => {
  it('opens on the step the server last recorded', async () => {
    seedOnboardingState({ step: 'TIME' });

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.step).toBe('TIME');
  });

  it('advances optimistically and keeps the step when the save succeeds', async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.saveAnswers({ step: 'DOMAINS', sixMonthVision: 'A better morning' });
    });

    expect(result.current.step).toBe('DOMAINS');
    expect(result.current.error).toBeNull();
    expect(onboardingPatches()).toContainEqual({
      step: 'DOMAINS',
      sixMonthVision: 'A better morning',
    });
  });

  it('reverts the step and shows the error when the save fails', async () => {
    seedOnboardingState({ step: 'VISION' });

    server.use(
      http.patch('*/api/onboarding/answers', () =>
        HttpResponse.json({ message: 'Could not save that. Try again.' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current
        .saveAnswers({ step: 'DOMAINS', sixMonthVision: 'A better morning' })
        .catch(() => undefined);
    });

    expect(result.current.step).toBe('VISION');
    expect(result.current.error).toBeTruthy();
  });

  it('moves back without sending a PATCH — the answers are already saved', async () => {
    seedOnboardingState({ step: 'TIME' });

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.goTo('REALITY'));

    expect(result.current.step).toBe('REALITY');
    expect(onboardingPatches()).toHaveLength(0);
  });

  it('folds a proposal into the state so a remount does not ask again', async () => {
    seedOnboardingState({
      step: 'PROPOSAL',
      answers: {
        sixMonthVision: 'A better morning',
        domains: ['WORK', 'HEALTH'],
        domainReflections: null,
        obstacles: [],
        weekdayMinutes: 45,
        healthBaseline: null,
        coachingStyle: 'BALANCED',
      },
    });

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.propose();
    });

    expect(result.current.state?.pendingProposal?.outcomes).toHaveLength(2);
    expect(result.current.state?.proposalSource).toBe('ai');
  });

  it('marks the state complete after approve without advancing past step 9', async () => {
    seedOnboardingState({ step: 'PROPOSAL' });

    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const proposal = await act(async () => (await result.current.propose()).proposal);

    await act(async () => {
      await result.current.approve(proposal!);
    });

    expect(result.current.state?.completed).toBe(true);
    expect(result.current.step).toBe('PROPOSAL');
  });
});
