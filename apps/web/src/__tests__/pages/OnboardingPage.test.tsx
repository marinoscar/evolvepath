/**
 * The onboarding wizard (issue #102, epic E04).
 *
 * Driven through the REAL `useOnboarding` against the stateful MSW handlers, so
 * these assertions are about the PATCH bodies the page actually sends and the
 * step the server actually recorded — not a stub's promise to send them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';
import { http, HttpResponse } from 'msw';

import { render } from '../utils/test-utils';
import { mockUser } from '../utils/test-utils';
import { server } from '../mocks/server';
import OnboardingPage from '../../pages/OnboardingPage';
import {
  onboardingPatches,
  onboardingStarts,
  onboardingState,
  seedOnboardingState,
} from '../mocks/onboardingHandlers';
import {
  DOMAINS_TITLE,
  OBSTACLE_LABELS,
  PROMISE_CTA,
  PROMISE_TITLE,
  REALITY_TITLE,
  TIME_TITLE,
  VISION_TITLE,
  COACHING_TITLE,
  HEALTH_TITLE,
  NOTIFICATIONS_TITLE,
} from '../../components/onboarding/copy';

// jsdom performs no layout, so `color-contrast` is a known false-negative trap.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const unonboarded = { ...mockUser, onboarding: { completed: false } };

function renderPage(user = unonboarded) {
  return render(<OnboardingPage />, {
    wrapperOptions: { route: '/onboarding', user },
  });
}

/** Walks from step 1 to the domain step, which most cases start from. */
async function reachDomains(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: PROMISE_CTA }));
  await screen.findByRole('heading', { name: VISION_TITLE });

  await user.type(
    screen.getByLabelText(/six months from now/i),
    'I want my mornings back and dinners that are not on a phone',
  );
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: DOMAINS_TITLE });
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    seedOnboardingState({ step: 'PROMISE', completed: false });
  });

  it('opens on the promise with the PRD §20 copy', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: PROMISE_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROMISE_CTA })).toBeInTheDocument();
  });

  it('starts with the browser timezone and moves to the vision step', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: PROMISE_CTA }));

    expect(await screen.findByRole('heading', { name: VISION_TITLE })).toBeInTheDocument();
    await waitFor(() => expect(onboardingStarts()).toHaveLength(1));
    expect(onboardingStarts()[0].timezone).toEqual(expect.any(String));
    expect(onboardingStarts()[0].timezone.length).toBeGreaterThan(0);
  });

  it('will not advance past the vision until there is enough to plan from', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: PROMISE_CTA }));
    await screen.findByRole('heading', { name: VISION_TITLE });

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.type(screen.getByLabelText(/six months from now/i), 'Get my mornings back again');

    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('sends the exact PATCH body for each step', async () => {
    const user = userEvent.setup();
    renderPage();

    await reachDomains(user);

    await user.click(screen.getByRole('checkbox', { name: 'Work' }));
    await user.click(screen.getByRole('checkbox', { name: 'Family' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: REALITY_TITLE });
    await user.click(screen.getByRole('checkbox', { name: OBSTACLE_LABELS.PROCRASTINATE }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: TIME_TITLE });

    await waitFor(() => {
      expect(onboardingPatches()).toEqual([
        expect.objectContaining({
          step: 'DOMAINS',
          sixMonthVision: 'I want my mornings back and dinners that are not on a phone',
        }),
        expect.objectContaining({ step: 'REALITY', domains: ['WORK', 'FAMILY'] }),
        expect.objectContaining({ step: 'TIME', obstacles: ['PROCRASTINATE'] }),
      ]);
    });
  });

  it('requires at least one area before leaving step 3', async () => {
    const user = userEvent.setup();
    renderPage();

    await reachDomains(user);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('skips the health baseline when Health was not selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await reachDomains(user);
    await user.click(screen.getByRole('checkbox', { name: 'Work' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: REALITY_TITLE });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: TIME_TITLE });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('heading', { name: COACHING_TITLE })).toBeInTheDocument();
    await waitFor(() =>
      expect(onboardingPatches().at(-1)).toMatchObject({ step: 'COACHING_STYLE' }),
    );
  });

  it('shows the health baseline when Health was selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await reachDomains(user);
    await user.click(screen.getByRole('checkbox', { name: 'Health' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: REALITY_TITLE });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: TIME_TITLE });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('heading', { name: HEALTH_TITLE })).toBeInTheDocument();
  });

  it('reopens on the saved step with the previous answers filled in', async () => {
    seedOnboardingState({
      step: 'TIME',
      answers: {
        sixMonthVision: 'Mornings back',
        domains: ['WORK'],
        domainReflections: { work: 'I open email first' },
        obstacles: ['FORGET'],
        weekdayMinutes: 45,
        healthBaseline: null,
        coachingStyle: 'DIRECT',
      },
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: TIME_TITLE })).toBeInTheDocument();

    // `waitFor`: the step renders as soon as the state lands, and the local
    // drafts are seeded from it on the following commit — so there is one frame
    // in which the slider still shows its default.
    await waitFor(() =>
      expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '45'),
    );
  });

  it('goes back without a PATCH and keeps what was entered', async () => {
    seedOnboardingState({
      step: 'TIME',
      answers: {
        sixMonthVision: 'Mornings back',
        domains: ['WORK'],
        domainReflections: null,
        obstacles: ['FORGET'],
        weekdayMinutes: 45,
        healthBaseline: null,
        coachingStyle: 'BALANCED',
      },
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: TIME_TITLE });
    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(await screen.findByRole('heading', { name: REALITY_TITLE })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: OBSTACLE_LABELS.FORGET })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(onboardingPatches()).toHaveLength(0);
  });

  it('stays on the step and reports a failed save', async () => {
    seedOnboardingState({ step: 'VISION' });

    server.use(
      http.patch('*/api/onboarding/answers', () =>
        HttpResponse.json({ message: 'The server said no.' }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: VISION_TITLE });
    await user.type(
      screen.getByLabelText(/six months from now/i),
      'I want my mornings back and dinners that are not on a phone',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The server said no.');
    expect(screen.getByRole('heading', { name: VISION_TITLE })).toBeInTheDocument();
  });

  it('explains notifications before prompting, and never prompts on mount', async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });

    seedOnboardingState({ step: 'NOTIFICATIONS' });
    renderPage();

    expect(await screen.findByRole('heading', { name: NOTIFICATIONS_TITLE })).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('sends a completed user home rather than letting them redo onboarding', async () => {
    seedOnboardingState({ step: 'DONE', completed: true });

    renderPage({ ...mockUser, onboarding: { completed: true } });

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: PROMISE_TITLE })).not.toBeInTheDocument(),
    );
  });

  it('announces which step of how many, counting only the steps this user sees', async () => {
    // Health is not selected, so the health baseline is not one of them: eight,
    // not the nine PRD §20 lists.
    renderPage();

    expect(await screen.findByText(/step 1 of 8/i)).toBeInTheDocument();
  });

  it.each([
    ['PROMISE'],
    ['VISION'],
    ['DOMAINS'],
    ['REALITY'],
    ['TIME'],
    ['COACHING_STYLE'],
    ['NOTIFICATIONS'],
  ] as const)('has no axe violations on %s', async (step) => {
    seedOnboardingState({ step });

    const { container } = renderPage();

    await screen.findByRole('heading', { level: 1 });

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('OnboardingPage — the server is the only store', () => {
  it('writes nothing to localStorage or sessionStorage', async () => {
    const user = userEvent.setup();
    seedOnboardingState({ step: 'PROMISE' });

    renderPage();

    await user.click(await screen.findByRole('button', { name: PROMISE_CTA }));
    await screen.findByRole('heading', { name: VISION_TITLE });
    await user.type(screen.getByLabelText(/six months from now/i), 'Mornings back, dinners kept');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: DOMAINS_TITLE });

    const stored = [
      ...Object.keys(window.localStorage),
      ...Object.keys(window.sessionStorage),
    ].filter((key) => key.toLowerCase().includes('onboard'));

    expect(stored).toEqual([]);
    expect(onboardingState().answers.sixMonthVision).toBe('Mornings back, dinners kept');
  });
});

/** Silences the unused import lint without weakening the assertions above. */
void within;
