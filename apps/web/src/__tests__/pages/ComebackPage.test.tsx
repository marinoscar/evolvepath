import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import { setComebackStatus } from '../mocks/comebackHandlers';
import ComebackPage from '../../pages/ComebackPage';

// =============================================================================
// The comeback flow (issue #119, epic E11)
// =============================================================================
//
// The properties this file exists to hold:
//
//   * PRD §57's three headlines appear, verbatim and in order;
//   * a reload lands on the step the user was on, not at the beginning of an
//     apology;
//   * Start hands the ordinary execution screen a `returnTo`, which is the only
//     comeback-specific thing about that screen;
//   * NOTHING anywhere lists what was missed.
// =============================================================================

/** Renders the flow with a stub Start screen that reports its router state. */
function StartStub() {
  const location = useLocation();
  return (
    <div data-testid="start-screen">
      {JSON.stringify(location.state)}
      <span data-testid="start-path">{location.pathname}</span>
    </div>
  );
}

function renderFlow(route = '/comeback') {
  return render(
    <Routes>
      <Route path="/comeback" element={<ComebackPage />} />
      <Route path="/start/:commitmentId" element={<StartStub />} />
      <Route path="/" element={<div data-testid="today-screen" />} />
    </Routes>,
    { wrapperOptions: { route } },
  );
}

describe('ComebackPage (#119)', () => {
  describe('step 1', () => {
    it('opens with PRD §57’s first headline and no reckoning', async () => {
      const { container } = renderFlow();

      expect(
        await screen.findByRole('heading', { level: 1, name: "You're still on the Path." }),
      ).toBeInTheDocument();
      expect(screen.getByText('No catching up. We start from today.')).toBeInTheDocument();
      expect(screen.getByText(/The last 4 days got away from you/)).toBeInTheDocument();

      // Nothing anywhere names what was missed.
      expect(container.textContent ?? '').not.toMatch(
        /\b(overdue|behind|failed|streak|missed \d)\b/i,
      );
    });

    it('omits the idle sentence for a repeated-miss trigger', async () => {
      setComebackStatus({ trigger: 'REPEATED_MISSES', idleDays: 0 });

      renderFlow();
      await screen.findByRole('heading', { level: 1 });

      expect(screen.queryByText(/got away from you/)).not.toBeInTheDocument();
    });

    it('lets the user decline being helped, and goes home', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });

      await user.click(screen.getByRole('button', { name: 'Not now' }));

      expect(await screen.findByTestId('today-screen')).toBeInTheDocument();
    });
  });

  describe('step 2', () => {
    it('asks PRD §57’s question and puts the recommendation first', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });

      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'Which area feels most important to restart?',
        }),
      ).toBeInTheDocument();

      const recommended = screen.getByTestId('comeback-recommended');
      // The chip's TEXT is the carrier; the outline alone would be colour-only.
      expect(within(recommended).getByText('Recommended')).toBeInTheDocument();
      expect(within(recommended).getByText('12-minute bodyweight circuit')).toBeInTheDocument();
      expect(
        within(recommended).getByText(/easiest to rebuild/),
      ).toBeInTheDocument();
    });

    it('offers the other domains as alternatives', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByText('Morning focus block · 10 min')).toBeInTheDocument();
    });

    it('taking the recommendation moves to the action', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      await user.click(screen.getByRole('button', { name: 'Take the recommendation' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: '12-minute bodyweight circuit' }),
      ).toBeInTheDocument();
    });

    it('choosing another area swaps the restart the server returns', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      await user.click(screen.getByRole('button', { name: 'Choose Work' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Morning focus block' }),
      ).toBeInTheDocument();
    });
  });

  describe('step 3', () => {
    it('hands the ordinary Start screen a place to return to', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(screen.getByRole('button', { name: 'Take the recommendation' }));

      await user.click(await screen.findByRole('button', { name: 'Start' }));

      const start = await screen.findByTestId('start-screen');
      expect(within(start).getByTestId('start-path')).toHaveTextContent('/start/restart-1');
      expect(start).toHaveTextContent('"returnTo":"/comeback/done"');
    });

    it('lets the user change their mind', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(screen.getByRole('button', { name: 'Take the recommendation' }));

      await user.click(await screen.findByRole('button', { name: 'Choose a different area' }));

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'Which area feels most important to restart?',
        }),
      ).toBeInTheDocument();
    });
  });

  describe('resuming', () => {
    it('lands on the action when the loop is already in progress', async () => {
      setComebackStatus({ state: 'IN_PROGRESS' });

      renderFlow();

      expect(
        await screen.findByRole('heading', { level: 1, name: '12-minute bodyweight circuit' }),
      ).toBeInTheDocument();
    });

    it('says there is nothing to restart rather than showing an empty flow', async () => {
      setComebackStatus({ state: 'NONE', restart: null, recommendation: null });

      renderFlow();

      expect(
        await screen.findByText("Nothing to restart — you're on today's path."),
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('moves focus to each step’s heading', async () => {
      const user = userEvent.setup();
      renderFlow();
      await screen.findByRole('heading', { level: 1 });

      await user.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() =>
        expect(
          screen.getByRole('heading', {
            level: 1,
            name: 'Which area feels most important to restart?',
          }),
        ).toHaveFocus(),
      );
    });

    it('reports the step as readable text', async () => {
      renderFlow();
      expect(await screen.findByText('Step 1 of 3')).toBeInTheDocument();
    });

    it('has no violations', async () => {
      const { container } = renderFlow();
      await screen.findByRole('heading', { level: 1 });

      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
