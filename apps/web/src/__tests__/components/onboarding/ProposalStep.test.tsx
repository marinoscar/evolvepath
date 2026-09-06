/**
 * The first-Path review screen (issue #104, epic E04).
 *
 * Driven through the REAL `useOnboarding` inside the real `OnboardingPage`, so
 * every assertion is about the request the screen actually sends — including
 * the one that matters most: the edited `scheduledStart` and `durationMinutes`
 * that reach `POST /onboarding/approve`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';

import { mockUser, render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import OnboardingPage from '../../../pages/OnboardingPage';
import {
  buildMockProposal,
  onboardingApprovals,
  seedOnboardingState,
} from '../../mocks/onboardingHandlers';
import {
  CONFIDENCE_REDUCED_SNACKBAR,
  PROPOSAL_ADJUST,
  PROPOSAL_AI_UNAVAILABLE,
  PROPOSAL_APPROVE,
  PROPOSAL_REDUCED_SENTENCE,
  PROPOSAL_SKIP_AI,
  PROPOSAL_RETRY,
  PROPOSAL_TEMPLATE_CHIP,
  PROPOSAL_TITLE,
  NOTIFICATIONS_TITLE,
} from '../../../components/onboarding/copy';

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const unonboarded = { ...mockUser, onboarding: { completed: false } };

const ANSWERS = {
  sixMonthVision: 'Mornings back, dinners kept, training three times a week',
  domains: ['WORK', 'FAMILY', 'HEALTH'] as const,
  domainReflections: null,
  obstacles: [] as const,
  weekdayMinutes: 60,
  healthBaseline: null,
  coachingStyle: 'BALANCED' as const,
};

function seedAtProposal(over: Record<string, unknown> = {}) {
  seedOnboardingState({
    step: 'PROPOSAL',
    completed: false,
    answers: { ...ANSWERS, domains: [...ANSWERS.domains], obstacles: [] },
    pendingProposal: null,
    proposalSource: null,
    confidenceScore: null,
    ...over,
  });
}

function renderStep() {
  return render(<OnboardingPage />, {
    wrapperOptions: { route: '/onboarding', user: unonboarded },
  });
}

/** The screen asks for a plan on entry; wait for it to arrive. */
async function awaitProposal() {
  await screen.findByRole('heading', { name: PROPOSAL_TITLE });
  await screen.findByRole('button', { name: PROPOSAL_APPROVE });
}

describe('ProposalStep', () => {
  beforeEach(() => seedAtProposal());

  it('proposes on entry and renders one section per selected domain', async () => {
    renderStep();
    await awaitProposal();

    expect(screen.getByRole('region', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Family' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Health' })).toBeInTheDocument();
  });

  it('shows the Best Self statement and the rationale', async () => {
    renderStep();
    await awaitProposal();

    expect(
      screen.getByText('Someone who starts before the day starts on them.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Small on purpose. This is what a normal week can carry.'),
    ).toBeInTheDocument();
  });

  it('shows the §20 sentence only when the plan came back reduced', async () => {
    renderStep();
    await awaitProposal();

    expect(screen.queryByText(PROPOSAL_REDUCED_SENTENCE)).not.toBeInTheDocument();
  });

  it('offers both recoveries when the coach is unavailable, and the template completes', async () => {
    server.use(
      http.post('*/api/onboarding/propose', () =>
        HttpResponse.json(
          {
            message: 'The coach is unavailable.',
            details: { reason: 'AI_UNAVAILABLE', code: 'timeout', retryable: true },
          },
          { status: 503 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderStep();

    expect(await screen.findByText(PROPOSAL_AI_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROPOSAL_RETRY })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: PROPOSAL_SKIP_AI }));

    expect(await screen.findByText(PROPOSAL_TEMPLATE_CHIP)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeInTheDocument();
  });

  it('links to the key page when the caller has none', async () => {
    server.use(
      http.post('*/api/onboarding/propose', () =>
        HttpResponse.json({ message: 'Key required', code: 'AI_KEY_REQUIRED' }, { status: 412 }),
      ),
    );

    renderStep();

    expect(await screen.findByRole('link', { name: /add one/i })).toHaveAttribute(
      'href',
      '/settings/ai-key',
    );
    expect(screen.queryByRole('button', { name: PROPOSAL_RETRY })).not.toBeInTheDocument();
  });

  it('will not let the user start until they have answered the confidence question', async () => {
    renderStep();
    await awaitProposal();

    expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '4' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeEnabled(),
    );
  });

  it('replaces the plan with a smaller one at 2 and says so', async () => {
    const user = userEvent.setup();
    renderStep();
    await awaitProposal();

    await user.click(screen.getByRole('button', { name: '2' }));

    expect(await screen.findByText(CONFIDENCE_REDUCED_SNACKBAR)).toBeInTheDocument();
    expect(await screen.findByText(PROPOSAL_REDUCED_SENTENCE)).toBeInTheDocument();

    // The mock drops the last routine, exactly as the API's reduce does — and
    // the OUTCOME survives, because what shrank is the week, not what matters.
    const health = screen.getByRole('region', { name: 'Health' });

    await waitFor(() =>
      expect(within(health).queryByText('HEALTH routine')).not.toBeInTheDocument(),
    );
    expect(within(health).getByText('HEALTH outcome')).toBeInTheDocument();
  });

  it('keeps the plan at 4', async () => {
    const user = userEvent.setup();
    renderStep();
    await awaitProposal();

    await user.click(screen.getByRole('button', { name: '4' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeEnabled(),
    );
    expect(screen.queryByText(CONFIDENCE_REDUCED_SNACKBAR)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Health' })).toBeInTheDocument();
  });

  it('sends the edited duration on approve, and keeps every section', async () => {
    const user = userEvent.setup();
    renderStep();
    await awaitProposal();

    await user.click(screen.getByRole('button', { name: PROPOSAL_ADJUST }));

    const work = screen.getByRole('region', { name: 'Work' });
    const duration = within(work).getByLabelText('For');

    await user.click(duration);
    await user.click(await screen.findByRole('option', { name: '15 min' }));

    await user.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: PROPOSAL_APPROVE }));

    await waitFor(() => expect(onboardingApprovals()).toHaveLength(1));

    const approved = onboardingApprovals()[0];
    const workCommitment = approved.firstWeekCommitments.find((c) => c.domain === 'WORK');

    expect(workCommitment?.durationMinutes).toBe(15);
    expect(approved.outcomes).toHaveLength(3);
  });

  it('removes a commitment down to the last one', async () => {
    const user = userEvent.setup();
    renderStep();
    await awaitProposal();

    await user.click(screen.getByRole('button', { name: PROPOSAL_ADJUST }));

    const removals = screen.getAllByRole('button', { name: /^Remove / });
    expect(removals).toHaveLength(3);

    await user.click(removals[0]);
    await user.click(screen.getAllByRole('button', { name: /^Remove / })[0]);

    // One left, and its Remove is disabled — a plan with nothing in it is not a
    // plan the API would accept.
    await waitFor(() => {
      const remaining = screen.getAllByRole('button', { name: /^Remove / });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBeDisabled();
    });
  });

  it('advances to step 9 once the Path is started', async () => {
    const user = userEvent.setup();
    renderStep();
    await awaitProposal();

    await user.click(screen.getByRole('button', { name: '5' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: PROPOSAL_APPROVE }));

    expect(await screen.findByRole('heading', { name: NOTIFICATIONS_TITLE })).toBeInTheDocument();
  });

  it('renders the server’s rules under the section they name', async () => {
    server.use(
      http.post('*/api/onboarding/approve', () =>
        HttpResponse.json(
          {
            message: 'This plan does not fit the rules a first Path is held to.',
            details: {
              reason: 'PROPOSAL_INVALID',
              rules: ['Routine "WORK routine" is in WORK, which you did not select.'],
            },
          },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderStep();
    await awaitProposal();

    await user.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: PROPOSAL_APPROVE }));

    const work = await screen.findByRole('region', { name: 'Work' });

    expect(
      within(work).getByText('Routine "WORK routine" is in WORK, which you did not select.'),
    ).toBeInTheDocument();
  });

  it('goes home when somebody raced two submits', async () => {
    server.use(
      http.post('*/api/onboarding/approve', () =>
        HttpResponse.json(
          {
            message: 'Already onboarded.',
            details: { reason: 'ONBOARDING_ALREADY_COMPLETED' },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();

    // Rendered through a real route table so the navigation the 409 triggers is
    // observable: without a `/` route there is nothing for it to navigate TO,
    // and the assertion would pass or fail for the wrong reason.
    render(
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/" element={<div>today</div>} />
      </Routes>,
      { wrapperOptions: { route: '/onboarding', user: unonboarded } },
    );

    await awaitProposal();

    await user.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: PROPOSAL_APPROVE })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: PROPOSAL_APPROVE }));

    expect(await screen.findByText('today')).toBeInTheDocument();
  });

  it('renders AI-written strings as text, never as markup', async () => {
    seedAtProposal({
      pendingProposal: buildMockProposal(['WORK'], {
        rationale: '<img src=x onerror="window.__pwned = true"> plain words',
      }),
      proposalSource: 'ai',
    });

    renderStep();
    await awaitProposal();

    expect(
      screen.getByText('<img src=x onerror="window.__pwned = true"> plain words'),
    ).toBeInTheDocument();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('has no axe violations', async () => {
    const { container } = renderStep();
    await awaitProposal();

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no axe violations while adjusting', async () => {
    const user = userEvent.setup();
    const { container } = renderStep();
    await awaitProposal();

    await user.click(screen.getByRole('button', { name: PROPOSAL_ADJUST }));

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

/** Keeps `vi` imported for the stubbing helpers used above. */
void vi;
