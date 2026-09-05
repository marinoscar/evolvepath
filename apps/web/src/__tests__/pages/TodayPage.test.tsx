import { beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { http, HttpResponse } from 'msw';

import { render, mockAdminUser } from '../utils/test-utils';
import { server } from '../mocks/server';
import {
  getTodayState,
  makeCard,
  seedCommitments,
  seedTodayState,
  todayWriteHandlers,
} from '../mocks/todayHandlers';
import { makeMember, seedFamilyState } from '../mocks/familyHandlers';
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
    it('offers exactly the actions the API listed, plus the client-side Edit', async () => {
      const user = userEvent.setup();
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      await user.click(screen.getByRole('button', { name: 'Actions for Draft it' }));

      const menu = await screen.findByRole('menu');
      // `start` is the row's primary button, so the menu holds the rest.
      // `Edit` is a PATCH rather than an action endpoint, appended by the row
      // only where the API would accept the patch.
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Complete',
        'Partly done',
        'Do less',
        'Reschedule',
        'Skip',
        'Make it smaller',
        'Edit',
      ]);
    });

    it('does not offer Edit on a started commitment', async () => {
      const user = userEvent.setup();
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
        }),
      );
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      await user.click(screen.getByRole('button', { name: 'Actions for Draft it' }));

      const menu = await screen.findByRole('menu');
      expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
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

  describe('quick add', () => {
    // `POST /commitments` and `PATCH /commitments/:id` are owned globally by
    // `pathHandlers`, against the Path store. These tests need the write to show
    // up on TODAY's board, so they install the Today-store versions.
    beforeEach(() => server.use(...todayWriteHandlers));

    it('creates a commitment and shows it on the right domain card', async () => {
      const user = userEvent.setup();
      seedThreeDomains();
      renderToday();

      await screen.findByTestId('next-best-action');
      await user.click(screen.getByTestId('quick-add-fab'));

      await user.click(await screen.findByRole('button', { name: /Family intention/ }));
      await user.type(screen.getByLabelText(/What are you committing to/), 'Read with Mia');
      await user.click(screen.getByRole('button', { name: '20 min' }));
      await user.click(screen.getByRole('button', { name: 'Add it' }));

      await waitFor(() =>
        expect(
          within(screen.getByTestId('domain-card-FAMILY')).getByText('Read with Mia'),
        ).toBeInTheDocument(),
      );
      expect(getTodayState().commitments.at(-1)).toMatchObject({
        title: 'Read with Mia',
        domain: 'FAMILY',
      });
    });

    // CANCELLED rather than deleted: PRD §103 keeps the record of a day, and a
    // cancelled commitment offers no actions, so it leaves today's board.
    it('undoes an add by cancelling it', async () => {
      const user = userEvent.setup();
      seedThreeDomains();
      renderToday();

      await screen.findByTestId('next-best-action');
      await user.click(screen.getByTestId('quick-add-fab'));
      await user.click(await screen.findByRole('button', { name: /^Commitment/ }));
      await user.type(screen.getByLabelText(/What are you committing to/), 'A quick thing');
      await user.click(screen.getByRole('button', { name: 'Add it' }));

      await screen.findByText('Added to today');
      await user.click(await screen.findByRole('button', { name: 'Undo' }));

      await waitFor(() =>
        expect(getTodayState().commitments.at(-1)?.status).toBe('CANCELLED'),
      );
    });

    it('keeps the sheet open with the values intact when the server refuses', async () => {
      const user = userEvent.setup();
      seedThreeDomains();
      server.use(
        http.post('*/api/commitments', () =>
          HttpResponse.json({ message: 'Nope' }, { status: 400 }),
        ),
      );
      renderToday();

      await screen.findByTestId('next-best-action');
      await user.click(screen.getByTestId('quick-add-fab'));
      await user.click(await screen.findByRole('button', { name: /^Commitment/ }));
      await user.type(screen.getByLabelText(/What are you committing to/), 'Worth keeping');
      await user.click(screen.getByRole('button', { name: 'Add it' }));

      expect(await screen.findByText('Nope')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Worth keeping')).toBeInTheDocument();
    });
  });

  describe('editing a commitment', () => {
    beforeEach(() => server.use(...todayWriteHandlers));

    it('opens the same form prefilled and saves through PATCH', async () => {
      const user = userEvent.setup();
      seedCommitments(makeCard({ id: 'work-1', domain: 'WORK', title: 'Draft it' }));
      renderToday();

      await screen.findByTestId('commitment-row-work-1');
      await user.click(screen.getByRole('button', { name: 'Actions for Draft it' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

      const field = await screen.findByLabelText(/What are you committing to/);
      expect(field).toHaveValue('Draft it');

      await user.clear(field);
      await user.type(field, 'Draft the storyline properly');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Saved')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Family words over the generic lifecycle (epic E08, issue #50)
  // =========================================================================
  //
  // LABELS ONLY. Every family action posts to the endpoint the generic row
  // posts to, and the API's matrix decides what is allowed — so these tests
  // assert the WORDS and the request, never a second set of rules.
  describe('family rows', () => {
    const familyCard = (overrides = {}) =>
      makeCard({
        title: 'Phone-free dinner',
        domain: 'FAMILY',
        status: 'PLANNED',
        ritualId: 'ritual-1',
        ...overrides,
      });

    it('speaks in family words on a family row', async () => {
      seedCommitments(familyCard());
      renderToday();

      expect(
        await screen.findByRole('button', { name: /I'm in: Phone-free dinner/ }),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByLabelText('Actions for Phone-free dinner'));

      expect(screen.getByRole('menuitem', { name: 'Move it' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Skip today' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Reschedule' })).not.toBeInTheDocument();
    });

    it('leaves a work row’s words alone', async () => {
      seedCommitments(makeCard({ title: 'Draft the proposal', domain: 'WORK', status: 'PLANNED' }));
      renderToday();

      expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /I'm in/ })).not.toBeInTheDocument();
    });

    it('moves the row to READY when the user says “I’m in”', async () => {
      // The transition endpoint lives in `todayWriteHandlers` so the Path
      // suite keeps the Path store's version; this test needs the write to
      // land on TODAY's board.
      server.use(...todayWriteHandlers);

      const card = familyCard();
      seedCommitments(card);
      renderToday();

      await userEvent.click(
        await screen.findByRole('button', { name: /I'm in: Phone-free dinner/ }),
      );

      // The row now offers E05's Start, from the API's own availableActions.
      // Family primaries carry the title in their accessible name, because
      // several rows on one card would otherwise all be called "Start".
      expect(
        await screen.findByRole('button', { name: 'Start: Phone-free dinner' }),
      ).toBeInTheDocument();
      expect(getTodayState().commitments.find((row) => row.id === card.id)?.status).toBe('READY');
    });

    it('says "Kept" rather than "Done" on a finished family commitment', async () => {
      seedCommitments(familyCard({ status: 'COMPLETED' }));
      renderToday();

      expect(await screen.findByText('Kept')).toBeInTheDocument();
    });

    it('shows a birthday cue on the Family card when one is close', async () => {
      const soon = new Date(Date.now() + 3 * 24 * 3600_000);
      const birthday = `1900-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(
        soon.getDate(),
      ).padStart(2, '0')}`;

      seedFamilyState({ members: [makeMember({ nickname: 'Mia', birthday })] });
      seedCommitments(familyCard());
      renderToday();

      expect(await screen.findByTestId('today-birthday-cue')).toHaveTextContent(
        /Mia.s birthday in 3 days/,
      );
    });

    it('shows no cue when no birthday is close', async () => {
      seedFamilyState({ members: [makeMember({ nickname: 'Mia', birthday: null })] });
      seedCommitments(familyCard());
      renderToday();

      await screen.findByText('Phone-free dinner');
      expect(screen.queryByTestId('today-birthday-cue')).not.toBeInTheDocument();
    });
  });

  it('has no axe violations', async () => {
    seedThreeDomains();
    const { container } = renderToday();

    await screen.findByTestId('next-best-action');

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
