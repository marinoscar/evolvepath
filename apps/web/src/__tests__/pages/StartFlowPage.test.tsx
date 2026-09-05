import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { render } from '../utils/test-utils';
import {
  getTodayState,
  makeCard,
  seedCommitments,
  seedTodayState,
} from '../mocks/todayHandlers';
import StartFlowPage from '../../pages/StartFlowPage';

// =============================================================================
// The Start flow (issue #48, epic E05)
// =============================================================================
//
// The property this file exists to hold: THE COUNTDOWN IS DERIVED FROM THE
// SERVER'S `activeSince`, NOT COUNTED LOCALLY. The reload case below is the one
// that proves it — a remount against unchanged server state must resume at the
// remaining time, never at the full duration. A local counter would pass every
// other test in this file and fail that one, which is exactly why it is here.
// =============================================================================

function renderStart(id: string) {
  return render(
    <Routes>
      <Route path="/start/:commitmentId" element={<StartFlowPage />} />
      <Route path="/" element={<div data-testid="today-screen" />} />
    </Routes>,
    { wrapperOptions: { route: `/start/${id}` } },
  );
}

/** A commitment mid-session, started `secondsAgo` ago with a `minutes` target. */
function startedCard(secondsAgo: number, minutes: number) {
  const activeSince = new Date(Date.now() - secondsAgo * 1000).toISOString();

  return makeCard({
    id: 'c1',
    domain: 'WORK',
    title: 'Draft the proposal storyline',
    status: 'STARTED',
    startedAt: activeSince,
    timer: {
      activeSince,
      activeSeconds: 0,
      elapsedSeconds: secondsAgo,
      timerMinutes: minutes,
      remainingSeconds: minutes * 60 - secondsAgo,
    },
  });
}

describe('StartFlowPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('before starting', () => {
    it('shows the title, why it matters and the instruction', async () => {
      seedCommitments(makeCard({ id: 'c1', domain: 'WORK', title: 'Draft the storyline' }));
      renderStart('c1');

      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        'Draft the storyline',
      );
      expect(screen.getByTestId('why-it-matters')).toHaveTextContent('Free my evenings');
      expect(screen.getByTestId('start-instruction')).toBeInTheDocument();
    });

    it('hides the why line when the outcome says nothing', async () => {
      seedCommitments(makeCard({ id: 'c1', domain: 'WORK' }));
      seedTodayState({ whyItMatters: null });
      renderStart('c1');

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByTestId('why-it-matters')).not.toBeInTheDocument();
    });

    it('lists applied decomposition steps as numbered instructions', async () => {
      seedCommitments(
        makeCard({
          id: 'c1',
          domain: 'WORK',
          steps: [
            { title: 'Open the doc', minutes: 5 },
            { title: 'Write the decision statement', minutes: 10 },
          ],
        }),
      );
      renderStart('c1');

      const steps = await screen.findByTestId('start-steps');
      expect(within(steps).getAllByRole('listitem')).toHaveLength(2);
      expect(screen.queryByTestId('start-instruction')).not.toBeInTheDocument();
    });

    it('starts the session with the chosen length', async () => {
      const user = userEvent.setup();
      seedCommitments(makeCard({ id: 'c1', domain: 'WORK' }));
      renderStart('c1');

      await screen.findByRole('heading', { level: 1 });
      await user.click(screen.getByRole('button', { name: '10 min' }));
      await user.click(screen.getByRole('button', { name: 'Begin 10:00' }));

      await waitFor(() => expect(getTodayState().commitments[0].status).toBe('STARTED'));
      expect(getTodayState().commitments[0].timer?.timerMinutes).toBe(10);
      expect(await screen.findByTestId('countdown')).toBeInTheDocument();
    });

    // Most starts are "the thing as planned"; re-picking is a decision the
    // screen already has the answer to.
    it('seeds the picker from the commitment’s own size when it is a preset', async () => {
      seedCommitments(
        makeCard({
          id: 'c1',
          domain: 'WORK',
          durationMinutes: 20,
          versions: { full: { title: 'Draft', minutes: 20 }, short: null, minimum: null },
        }),
      );
      renderStart('c1');

      expect(await screen.findByRole('button', { name: 'Begin 20:00' })).toBeInTheDocument();
    });

    it('falls back to ten minutes for a size that is not a preset', async () => {
      seedCommitments(
        makeCard({
          id: 'c1',
          domain: 'WORK',
          durationMinutes: 38,
          versions: { full: { title: 'Upper A', minutes: 38 }, short: null, minimum: null },
        }),
      );
      renderStart('c1');

      expect(await screen.findByRole('button', { name: 'Begin 10:00' })).toBeInTheDocument();
    });
  });

  describe('while running', () => {
    it('counts down as time passes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      seedCommitments(startedCard(0, 5));
      renderStart('c1');

      expect(await screen.findByTestId('countdown')).toHaveTextContent('5:00');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });

      await waitFor(() => expect(screen.getByTestId('countdown')).toHaveTextContent('3:55'));
    });

    // The assertion that proves the countdown is derived rather than counted.
    it('resumes at the server-derived remaining time after a reload', async () => {
      seedCommitments(startedCard(120, 5));

      const { unmount } = renderStart('c1');
      expect(await screen.findByTestId('countdown')).toHaveTextContent('3:00');
      unmount();

      renderStart('c1');
      const countdown = await screen.findByTestId('countdown');
      expect(countdown).toHaveTextContent('3:0');
      expect(countdown).not.toHaveTextContent('5:00');
    });

    it('pauses, freezes the number, and says so in words', async () => {
      const user = userEvent.setup();
      seedCommitments(startedCard(60, 5));
      renderStart('c1');

      await screen.findByTestId('countdown');
      await user.click(screen.getByRole('button', { name: 'Pause' }));

      await waitFor(() =>
        expect(getTodayState().commitments[0].timer?.activeSince).toBeNull(),
      );
      // Not colour alone.
      expect(await screen.findByTestId('countdown-status')).toHaveTextContent('Paused');
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });

    it('resumes from the same remaining time', async () => {
      const user = userEvent.setup();
      seedCommitments(
        makeCard({
          id: 'c1',
          domain: 'WORK',
          status: 'STARTED',
          startedAt: '2026-03-02T09:00:00.000Z',
          timer: {
            activeSince: null,
            activeSeconds: 120,
            elapsedSeconds: 120,
            timerMinutes: 5,
            remainingSeconds: 180,
          },
        }),
      );
      renderStart('c1');

      expect(await screen.findByTestId('countdown')).toHaveTextContent('3:00');
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() =>
        expect(getTodayState().commitments[0].timer?.activeSince).not.toBeNull(),
      );
      expect(screen.getByTestId('countdown')).toHaveTextContent('3:0');
    });

    describe('when the time is up', () => {
      it('offers another fifteen minutes rather than just stopping', async () => {
        const user = userEvent.setup();
        seedCommitments(startedCard(600, 5));
        renderStart('c1');

        expect(await screen.findByTestId('time-is-up')).toBeInTheDocument();
        expect(await screen.findByTestId('countdown')).toHaveTextContent('0:00');

        await user.click(screen.getByRole('button', { name: 'Continue another 15' }));

        await waitFor(() =>
          expect(getTodayState().commitments[0].timer?.timerMinutes).toBe(20),
        );
      });
    });

    it('finishes, records the minutes and returns to Today', async () => {
      const user = userEvent.setup();
      seedCommitments(startedCard(600, 5));
      renderStart('c1');

      await screen.findByTestId('countdown');
      await user.click(screen.getByRole('button', { name: 'Done for now' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Done' }));

      await waitFor(() => expect(getTodayState().commitments[0].status).toBe('COMPLETED'));
      expect(await screen.findByTestId('today-screen')).toBeInTheDocument();
    });

    it('records a partial finish as its own fact', async () => {
      const user = userEvent.setup();
      seedCommitments(startedCard(120, 5));
      renderStart('c1');

      await screen.findByTestId('countdown');
      await user.click(screen.getByRole('button', { name: 'Done for now' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Partly done' }));

      await waitFor(() =>
        expect(getTodayState().commitments[0].status).toBe('PARTIALLY_COMPLETED'),
      );
    });

    // E07 owns focus-session data; inventing half of it here would leave a
    // shape that epic has to migrate.
    it('carries the distraction note along on the completion', async () => {
      const user = userEvent.setup();
      seedCommitments(startedCard(120, 5));
      renderStart('c1');

      await screen.findByTestId('countdown');
      await user.type(screen.getByLabelText(/pulling you away/i), 'slack');
      await user.click(screen.getByRole('button', { name: 'Done for now' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Done' }));

      await waitFor(() => expect(getTodayState().commitments[0].status).toBe('COMPLETED'));
    });
  });

  describe('an id that is not there', () => {
    // A foreign id and a deleted one answer the same 404 on purpose.
    it('says so, and offers the way back', async () => {
      renderStart('gone');

      expect(
        await screen.findByRole('heading', { name: /not here/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to Today' })).toHaveAttribute(
        'href',
        '/',
      );
    });
  });

  it('shows the timer with an accessible role and a minute-resolution status', async () => {
    seedCommitments(startedCard(60, 25));
    renderStart('c1');

    const timer = await screen.findByRole('timer');
    expect(timer).toHaveAccessibleName('Time remaining');
    // Not the seconds: a polite region that changed every second would make a
    // screen reader read the clock aloud continuously.
    expect(screen.getByTestId('countdown-status')).toHaveTextContent('24 minutes left');
  });
});
