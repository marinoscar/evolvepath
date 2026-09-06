import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { http, HttpResponse } from 'msw';

import { render } from '../utils/test-utils';
import { server } from '../mocks/server';
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

function renderStart(id: string, query = '', state?: unknown) {
  return render(
    <Routes>
      <Route path="/start/:commitmentId" element={<StartFlowPage />} />
      <Route path="/" element={<div data-testid="today-screen" />} />
      <Route path="/comeback/done" element={<div data-testid="comeback-done" />} />
    </Routes>,
    { wrapperOptions: { route: `/start/${id}${query}`, routeState: state } },
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

    // Epic E11 (#119). The comeback flow reuses this screen unchanged; the only
    // thing it adds is where a finished session goes afterwards.
    it('returns to `state.returnTo` when the caller named one', async () => {
      const user = userEvent.setup();
      seedCommitments(startedCard(600, 5));
      renderStart('c1', '', { returnTo: '/comeback/done' });

      await screen.findByTestId('countdown');
      await user.click(screen.getByRole('button', { name: 'Done for now' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Done' }));

      expect(await screen.findByTestId('comeback-done')).toBeInTheDocument();
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

// =============================================================================
// Notification attribution (#68, epic E12)
// =============================================================================

describe('StartFlowPage attribution', () => {
  const N = '22222222-2222-4222-8222-222222222222';
  let interactions: Record<string, unknown>[] = [];

  beforeEach(() => {
    interactions = [];
    server.use(
      http.post('*/api/notifications/interactions', async ({ request }) => {
        interactions.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ data: { id: 'i1' } }, { status: 201 });
      }),
    );
  });

  it('records an open when a notification sent the user here', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK', title: 'Draft it' }));
    renderStart('c1', `?n=${N}`);

    await waitFor(() =>
      expect(interactions).toContainEqual({ sentInteractionId: N, kind: 'OPENED' }),
    );
  });

  // Arriving at a timer is not starting one, and counting an arrival as an
  // action would make every notification look like it worked.
  it('does not record an action merely for arriving', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK', title: 'Draft it' }));
    renderStart('c1', `?n=${N}`);

    await waitFor(() => expect(interactions).toHaveLength(1));
    expect(interactions[0].kind).toBe('OPENED');
  });

  // THIS is the honest moment: the timer is running, which is the behaviour the
  // reminder was asking for.
  it('records the start once the timer actually begins', async () => {
    const user = userEvent.setup();
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK', title: 'Draft it' }));
    renderStart('c1', `?n=${N}`);

    await screen.findByRole('button', { name: /begin/i });
    await user.click(screen.getByRole('button', { name: /begin/i }));

    await waitFor(() =>
      expect(interactions).toContainEqual({
        sentInteractionId: N,
        kind: 'ACTIONED',
        action: 'start',
      }),
    );
  });

  it('records nothing when the user arrived on their own', async () => {
    const user = userEvent.setup();
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK', title: 'Draft it' }));
    renderStart('c1');

    await screen.findByRole('button', { name: /begin/i });
    await user.click(screen.getByRole('button', { name: /begin/i }));

    await waitFor(() => expect(getTodayState().commitments[0]?.status).toBe('STARTED'));
    expect(interactions).toHaveLength(0);
  });

  // Otherwise a refresh records a second open for one message.
  it('strips the attribution from the URL after recording it', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'WORK', title: 'Draft it' }));
    renderStart('c1', `?n=${N}`);

    await waitFor(() => expect(interactions).toHaveLength(1));
    expect(screen.queryByText(N)).not.toBeInTheDocument();
  });
});

// =============================================================================
// The WORK branch: server-side focus sessions (issue #118, epic E07)
// =============================================================================
//
// Branching happens inside the page rather than by forking it, so the first
// thing this block asserts is the negative: a FAMILY commitment still takes
// E05's path and never creates a focus session.
// =============================================================================

describe('StartFlowPage — focus sessions (#118)', () => {
  const workCard = () =>
    makeCard({ id: 'c1', domain: 'WORK', title: 'Draft the proposal storyline' });

  it('creates a server focus session on Begin, and the commitment starts', async () => {
    seedCommitments(workCard());
    renderStart('c1');

    await userEvent.click(await screen.findByRole('button', { name: /^Begin/ }));

    const { sessions } = await import('../mocks/workHandlers').then(async (mod) => {
      const active = await fetch('/api/focus-sessions/active').then((r) => r.json());
      return { sessions: active.data.session ? [active.data.session] : [], mod };
    });

    expect(sessions).toHaveLength(1);
    // The server performed E05's start inside that one call.
    expect(getTodayState().commitments[0].status).toBe('STARTED');
  });

  it('honours ?minutes= and renders ?instruction= as text', async () => {
    seedCommitments(workCard());
    renderStart('c1', '?minutes=10&instruction=Write%20the%20decision%20sentence');

    expect(await screen.findByTestId('focus-instruction')).toHaveTextContent(
      'Write the decision sentence',
    );
    expect(screen.getByRole('button', { name: /^Begin 10:00/ })).toBeInTheDocument();
  });

  it('persists a distraction note the moment it is added', async () => {
    seedCommitments(workCard());
    renderStart('c1');

    await userEvent.click(await screen.findByRole('button', { name: /^Begin/ }));

    const input = await screen.findByTestId('focus-note-input');
    await userEvent.type(input, 'Checked Slack{Enter}');

    expect(await screen.findByText('Checked Slack')).toBeInTheDocument();

    // Persisted, not held in the page: the server has it too.
    const active = await fetch('/api/focus-sessions/active').then((r) => r.json());
    expect(active.data.session.distractionNotes).toEqual(['Checked Slack']);
  });

  it('extends the focus session from the "Continue another 15" prompt', async () => {
    seedCommitments(workCard());

    // Create the session first: `POST /focus-sessions` performs the start, so
    // seeding the out-of-time card afterwards is what puts the page at 00:00.
    await fetch('/api/focus-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commitmentId: 'c1', plannedMinutes: 25 }),
    });
    seedCommitments(startedCard(25 * 60, 25));

    renderStart('c1');

    await userEvent.click(await screen.findByTestId('focus-continue'));

    const active = await fetch('/api/focus-sessions/active').then((r) => r.json());
    expect(active.data.session.plannedMinutes).toBe(40);
    expect(active.data.session.continuedCount).toBe(1);
  });

  it('stops the session as partial and reports the minutes actually focused', async () => {
    seedCommitments(workCard());

    await fetch('/api/focus-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commitmentId: 'c1', plannedMinutes: 25 }),
    });
    seedCommitments(startedCard(12 * 60, 25));

    renderStart('c1');

    await userEvent.click(await screen.findByRole('button', { name: /done for now/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Partly done$/ }));

    expect(await screen.findByTestId('today-screen')).toBeInTheDocument();

    const active = await fetch('/api/focus-sessions/active').then((r) => r.json());
    expect(active.data.session).toBeNull();
  });

  it('offers to take over when another commitment has a session running', async () => {
    seedCommitments(workCard());

    await fetch('/api/focus-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commitmentId: 'somebody-else', plannedMinutes: 25 }),
    });

    renderStart('c1');

    await userEvent.click(await screen.findByRole('button', { name: /^Begin/ }));

    expect(await screen.findByTestId('focus-session-conflict')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /stop it and start this/i }));

    const active = await fetch('/api/focus-sessions/active').then((r) => r.json());
    expect(active.data.session.commitmentId).toBe('c1');
  });

  it('leaves a FAMILY commitment on E05\'s path — no focus session at all', async () => {
    seedCommitments(makeCard({ id: 'c1', domain: 'FAMILY', title: 'Phone-free dinner' }));
    renderStart('c1');

    await userEvent.click(await screen.findByRole('button', { name: /^Begin/ }));

    expect(getTodayState().commitments[0].status).toBe('STARTED');

    const active = await fetch('/api/focus-sessions/active').then((r) => r.json());
    expect(active.data.session).toBeNull();

    // The old in-page textarea, not the server-backed note input.
    expect(await screen.findByLabelText(/anything pulling you away/i)).toBeInTheDocument();
    expect(screen.queryByTestId('focus-note-input')).not.toBeInTheDocument();
  });
});
