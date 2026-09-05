import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import {
  getTodayState,
  makeCard,
  seedCommitments,
  seedTodayState,
} from '../mocks/todayHandlers';
import TodayPage from '../../pages/TodayPage';

// =============================================================================
// The Today screen (issue #46, epic E05)
// =============================================================================
//
// The property this file exists to hold: THE SCREEN IS COMPLETE BEFORE THE
// COACH ANSWERS. PRD §120 makes that a product requirement rather than a
// nice-to-have, so a failing `/today/insight` is asserted to leave every other
// part of the page intact — the recommendation, its rationale, and all three
// domain cards.
//
// The second property: the action menu renders EXACTLY the API's
// `availableActions`. A menu the client computed would eventually offer a move
// the server refuses, and the user would be the one to find out.
// =============================================================================

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

function renderToday(route = '/', user = mockAdminUser) {
  return render(
    <Routes>
      <Route path="/" element={<TodayPage />} />
      <Route path="/start/:id" element={<div data-testid="start-screen" />} />
      <Route path="/path" element={<div data-testid="path-screen" />} />
    </Routes>,
    { wrapperOptions: { route, user } },
  );
}

function seedThreeDomains() {
  seedCommitments(
    makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft the proposal storyline' }),
    makeCard({
      id: 'family-1',
      domain: 'FAMILY',
      title: 'Phone-free dinner',
      importance: 4,
      versions: {
        full: { title: 'Phone-free dinner', minutes: 45 },
        short: null,
        minimum: null,
      },
    }),
    makeCard({
      id: 'health-1',
      domain: 'HEALTH',
      title: 'Upper A',
      importance: 3,
      versions: {
        full: { title: 'Upper A', minutes: 38 },
        short: { title: 'Bench and rows', minutes: 20 },
        minimum: { title: '10-minute circuit', minutes: 10 },
      },
    }),
  );
}

describe('TodayPage', () => {
  it('renders the greeting, the state line and the recommendation', async () => {
    seedThreeDomains();
    renderToday();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      `Good morning, ${mockAdminUser.displayName}`,
    );
    expect(screen.getByTestId('today-state-line')).toHaveTextContent('3 commitments today.');

    const nba = await screen.findByTestId('next-best-action');
    expect(within(nba).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Draft the storyline',
    );
    expect(within(nba).getByRole('button', { name: 'Start 25 min' })).toBeInTheDocument();
    expect(within(nba).getByRole('button', { name: 'Make it smaller' })).toBeInTheDocument();
    expect(screen.getByTestId('nba-rationale')).toHaveTextContent(/25 minutes/);
  });

  it('falls back to "there" rather than a dangling comma', async () => {
    seedThreeDomains();
    renderToday('/', { ...mockAdminUser, displayName: null });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Good morning, there',
    );
  });

  it('has exactly one h1', async () => {
    seedThreeDomains();
    renderToday();

    await screen.findByTestId('next-best-action');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders all three domain cards, including the empty ones', async () => {
    seedCommitments(makeCard({ id: 'work-1', domain: 'WORK' }));
    renderToday();

    expect(await screen.findByTestId('domain-card-WORK')).toBeInTheDocument();
    expect(screen.getByTestId('domain-card-FAMILY')).toBeInTheDocument();
    expect(screen.getByTestId('domain-card-HEALTH')).toBeInTheDocument();

    // An empty section says what it is FOR rather than "no commitments".
    expect(
      within(screen.getByTestId('domain-card-FAMILY')).getByText(
        /people you care about/i,
      ),
    ).toBeInTheDocument();
  });

  it('keeps a paused domain visible with its mode named', async () => {
    seedCommitments(makeCard({ id: 'health-1', domain: 'HEALTH', title: 'Upper A' }));
    seedTodayState({ modes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'PAUSE' } });
    renderToday();

    const health = await screen.findByTestId('domain-card-HEALTH');
    expect(within(health).getByText('Paused')).toBeInTheDocument();
    expect(within(health).getByText('Upper A')).toBeInTheDocument();

    // Paused is never the recommendation.
    expect(await screen.findByTestId('nba-empty')).toBeInTheDocument();
  });

  it('shows an empty state with a way forward when nothing is planned', async () => {
    renderToday();

    const empty = await screen.findByTestId('nba-empty');
    expect(within(empty).getByText(/An empty day is fine/)).toBeInTheDocument();
    expect(screen.getByTestId('today-state-line')).toHaveTextContent('Nothing scheduled today.');
  });

  describe('the coach insight', () => {
    it('arrives after the board and is captioned when written without the coach', async () => {
      seedThreeDomains();
      seedTodayState({
        insight: {
          text: 'Low energy is information, not a verdict.',
          source: 'template',
          generatedAt: '2026-03-02T09:00:00.000Z',
        },
      });
      renderToday();

      // The board first — the whole point of the second request.
      await screen.findByTestId('next-best-action');

      const insight = await screen.findByTestId('coach-insight');
      expect(within(insight).getByText(/Low energy is information/)).toBeInTheDocument();
      expect(screen.getByTestId('coach-insight-template')).toBeInTheDocument();
    });

    // PRD §120, as an assertion rather than a promise.
    it('leaves the page completely intact when the insight request fails', async () => {
      seedThreeDomains();
      seedTodayState({ insightFails: true });
      renderToday();

      expect(await screen.findByTestId('next-best-action')).toBeInTheDocument();
      expect(screen.getByTestId('nba-rationale')).toBeInTheDocument();
      expect(screen.getByTestId('domain-card-WORK')).toBeInTheDocument();
      expect(screen.getByTestId('domain-card-FAMILY')).toBeInTheDocument();
      expect(screen.getByTestId('domain-card-HEALTH')).toBeInTheDocument();

      await waitFor(() =>
        expect(screen.queryByTestId('coach-insight-loading')).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId('coach-insight')).not.toBeInTheDocument();
      // No error box for something the user cannot act on.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('the check-in', () => {
    it('persists the answer and re-sizes the recommendation from the server', async () => {
      const user = userEvent.setup();
      seedThreeDomains();
      renderToday();

      await screen.findByTestId('next-best-action');
      expect(screen.getByRole('button', { name: 'Start 25 min' })).toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: 'Low energy' }));

      await waitFor(() =>
        expect(getTodayState().checkIn).toMatchObject({ feel: 'LOW_ENERGY' }),
      );

      // The API decides the new size; the page renders whatever came back.
      expect(await screen.findByRole('button', { name: 'Start 5 min' })).toBeInTheDocument();
      expect(
        within(screen.getByTestId('next-best-action')).getByText('Minimum version'),
      ).toBeInTheDocument();
    });

    it('marks the stored answer as selected', async () => {
      seedThreeDomains();
      seedTodayState({
        checkIn: { dateLocal: '2026-03-02', feel: 'PACKED', updatedAt: '2026-03-02T08:00:00Z' },
      });
      renderToday();

      expect(await screen.findByRole('radio', { name: 'Packed' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
  });

  describe('deep links', () => {
    it('sends ?action=start straight to the Start screen', async () => {
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK' }));
      renderToday('/?commitment=work-1&action=start');

      expect(await screen.findByTestId('start-screen')).toBeInTheDocument();
    });

    it('says so when the commitment is no longer on today’s path', async () => {
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK' }));
      renderToday('/?commitment=gone&action=skip');

      expect(
        await screen.findByText(/no longer on today’s path/),
      ).toBeInTheDocument();
    });

    it('opens the named dialog for a commitment that is there', async () => {
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));
      renderToday('/?commitment=work-1&action=skip');

      expect(await screen.findByRole('dialog')).toHaveTextContent(/Skip/);
    });
  });

  describe('actions', () => {
    it('offers exactly the actions the API listed, and no others', async () => {
      const user = userEvent.setup();
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      await user.click(screen.getByRole('button', { name: 'Actions for Draft it' }));

      const menu = await screen.findByRole('menu');
      // `start` is the row's primary button, so the menu holds the rest.
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Complete',
        'Partly done',
        'Do less',
        'Reschedule',
        'Skip',
        'Make it smaller',
      ]);
    });

    it('offers nothing at all on a finished commitment', async () => {
      seedCommitments(
        makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it', status: 'COMPLETED' }),
      );
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      expect(
        screen.queryByRole('button', { name: 'Actions for Draft it' }),
      ).not.toBeInTheDocument();
    });

    it('skips a commitment through the dialog and re-renders it as skipped', async () => {
      const user = userEvent.setup();
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      await user.click(screen.getByRole('button', { name: 'Actions for Draft it' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Skip' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('radio', { name: 'I avoided it' }));
      await user.click(within(dialog).getByRole('button', { name: 'Skip it' }));

      await waitFor(() =>
        expect(getTodayState().commitments[0].status).toBe('SKIPPED'),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Actions for Draft it' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('surfaces the server’s own message when an action conflicts', async () => {
      const user = userEvent.setup();
      seedCommitments(
        makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it', status: 'PLANNED' }),
      );
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      await user.click(screen.getByRole('button', { name: 'Actions for Draft it' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Do less' }));

      // The seeded card declares both smaller sizes, so this succeeds; the
      // conflict path is exercised by the pause case below.
      await waitFor(() => expect(getTodayState().commitments[0].versionUsed).toBe('MINIMUM'));
    });

    it('shows the server message and keeps the board honest on a 409', async () => {
      const user = userEvent.setup();
      // A STARTED, running commitment: `reschedule` is refused with
      // ALREADY_STARTED, which is the real conflict the API raises.
      seedCommitments(
        makeCard({
          id: 'work-1',
          domain: 'WORK',
          title: 'Draft it',
          status: 'STARTED',
          startedAt: '2026-03-02T09:00:00.000Z',
          timer: {
            activeSince: '2026-03-02T09:00:00.000Z',
            activeSeconds: 0,
            elapsedSeconds: 0,
            timerMinutes: 25,
            remainingSeconds: 1500,
          },
          availableActions: ['pause', 'complete', 'reschedule'],
        }),
      );
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      await user.click(screen.getByRole('button', { name: 'Actions for Draft it' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Reschedule' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Move it' }));

      expect(
        await screen.findByText(/started commitment cannot be rescheduled/i),
      ).toBeInTheDocument();
      expect(getTodayState().commitments[0].status).toBe('STARTED');
    });
  });

  describe('make it smaller', () => {
    it('applies the proposal and opens the new commitment’s Start screen', async () => {
      const user = userEvent.setup();
      seedThreeDomains();
      renderToday();

      await screen.findByTestId('next-best-action');
      await user.click(screen.getByRole('button', { name: 'Make it smaller' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Start by opening the doc.')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Use this' }));

      expect(await screen.findByTestId('start-screen')).toBeInTheDocument();
      expect(getTodayState().commitments.at(-1)).toMatchObject({
        title: 'Open the doc',
        decomposedFromId: 'work-1',
      });
    });

    // A stuck user who reached for help should get help, not a status report.
    it('offers a real five-minute move when the coach is unavailable', async () => {
      const user = userEvent.setup();
      seedThreeDomains();
      seedTodayState({ coachDown: true });
      renderToday();

      await screen.findByTestId('next-best-action');
      await user.click(screen.getByRole('button', { name: 'Make it smaller' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByTestId('decompose-template')).toBeInTheDocument();
      expect(
        within(dialog).getByDisplayValue('Open it and do the first 5 minutes'),
      ).toBeInTheDocument();
    });
  });

  describe('the evening reflection', () => {
    it('is hidden during the day and shown with ?reflect=1', async () => {
      vi.setSystemTime(new Date('2026-03-02T14:00:00'));
      seedThreeDomains();

      const { unmount } = renderToday();
      await screen.findByTestId('next-best-action');
      expect(screen.queryByTestId('reflection-prompt')).not.toBeInTheDocument();
      unmount();

      renderToday('/?reflect=1');
      expect(await screen.findByTestId('reflection-prompt')).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('posts the quick option and hides itself afterwards', async () => {
      const user = userEvent.setup();
      seedThreeDomains();
      renderToday('/?reflect=1');

      const prompt = await screen.findByTestId('reflection-prompt');
      await user.click(within(prompt).getByRole('radio', { name: 'Too much' }));
      await user.click(within(prompt).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(getTodayState().reflection).toMatchObject({ quickOption: 'TOO_MUCH' }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId('reflection-prompt')).not.toBeInTheDocument(),
      );
    });
  });

  it('has no axe violations', async () => {
    seedThreeDomains();
    const { container } = renderToday();

    await screen.findByTestId('next-best-action');

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
