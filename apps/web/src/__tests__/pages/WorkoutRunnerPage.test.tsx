import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import { WorkoutRunnerPage } from '../../pages/WorkoutRunnerPage';
import {
  buildSessionView,
  finishedSessions,
  loggedSetBodies,
  seedSession,
  setSetPostStatus,
} from '../mocks/workoutHandlers';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ sessionId: 'session-1' }),
  };
});

/** Fill the set inputs and press Complete set. */
async function completeSet(
  user: ReturnType<typeof userEvent.setup>,
  { reps = '12', discomfort }: { reps?: string; discomfort?: string } = {},
) {
  const repsField = screen.getByLabelText('Reps');
  await user.clear(repsField);
  await user.type(repsField, reps);

  if (discomfort) await user.click(screen.getByRole('button', { name: discomfort }));

  await user.click(screen.getByRole('button', { name: 'Complete set' }));
}

describe('WorkoutRunnerPage', () => {
  beforeEach(() => {
    seedSession();
    localStorage.clear();
  });

  afterEach(() => {
    setSetPostStatus(null);
    localStorage.clear();
  });

  it('reads PRD §41\'s header', async () => {
    render(<WorkoutRunnerPage />);

    expect(
      await screen.findByRole('heading', { name: 'Upper A · Workout 3 of 18' }),
    ).toBeInTheDocument();
  });

  it('shows what happened last time on this movement', async () => {
    render(<WorkoutRunnerPage />);

    expect(await screen.findByText('Last time: 20 kg × 12')).toBeInTheDocument();
  });

  it('says so plainly when there is no history rather than hiding the line', async () => {
    const view = buildSessionView();
    view.exercises[0].lastTime = null;
    seedSession(view);
    render(<WorkoutRunnerPage />);

    expect(await screen.findByText('Last time: —')).toBeInTheDocument();
  });

  it('prefills the suggested weight and posts a client-minted id', async () => {
    const user = userEvent.setup();
    render(<WorkoutRunnerPage />);

    await screen.findByTestId('set-inputs');
    expect(screen.getByLabelText('Weight in kilograms')).toHaveValue('22.5');

    await completeSet(user);

    await waitFor(() => expect(loggedSetBodies()).toHaveLength(1));
    expect(loggedSetBodies()[0]).toMatchObject({
      exerciseId: 'exercise-bench',
      setNumber: 1,
      weightKg: 22.5,
      reps: 12,
      discomfort: 'NONE',
    });
    expect(loggedSetBodies()[0].clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('explains the suggestion when the chip is tapped', async () => {
    const user = userEvent.setup();
    render(<WorkoutRunnerPage />);

    await user.click(await screen.findByTestId('progression-chip'));

    expect(
      await screen.findByText(/Two sessions at the top of the range/),
    ).toBeInTheDocument();
  });

  it('starts a rest timer that stays right after the tab is backgrounded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const start = new Date('2026-09-07T13:00:00.000Z');
    vi.setSystemTime(start);

    render(<WorkoutRunnerPage />);
    await screen.findByTestId('set-inputs');
    await completeSet(user);

    // 90 or 89: completing the set consumes real milliseconds even under fake
    // timers, and the timer reads a clock rather than a counter.
    expect(await screen.findByTestId('rest-timer')).toHaveTextContent(/Rest (90|89) s/);

    // The tab was hidden for a minute; a counter that decremented on an
    // interval would still say 89.
    act(() => {
      vi.setSystemTime(new Date(start.getTime() + 60_000));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByTestId('rest-timer')).toHaveTextContent(/Rest (31|30|29) s/);

    act(() => {
      vi.setSystemTime(new Date(start.getTime() + 120_000));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByTestId('rest-timer')).toHaveTextContent('Rest over');

    vi.useRealTimers();
  });

  it('shows the safety card and no set inputs after sharp pain', async () => {
    const user = userEvent.setup();
    render(<WorkoutRunnerPage />);

    await screen.findByTestId('set-inputs');
    await completeSet(user, { discomfort: 'Sharp pain' });

    const card = await screen.findByTestId('safety-card');
    expect(within(card).getByText(/not something to train through/)).toBeInTheDocument();

    // Stop, and stop. No "try it lighter".
    expect(within(card).getByRole('button', { name: 'Stop this exercise' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'End workout' })).toBeInTheDocument();
    expect(screen.queryByTestId('set-inputs')).not.toBeInTheDocument();
  });

  it('keeps a set on screen with a badge when the request fails', async () => {
    const user = userEvent.setup();
    setSetPostStatus(0);
    render(<WorkoutRunnerPage />);

    await screen.findByTestId('set-inputs');
    await completeSet(user);

    // The user did the set. A failed request must not take it away.
    expect(await screen.findByLabelText('Saved on this device')).toBeInTheDocument();
  });

  it('switches to a smaller version from the menu', async () => {
    const user = userEvent.setup();
    render(<WorkoutRunnerPage />);

    await user.click(await screen.findByRole('button', { name: 'Workout options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Use minimum version' }));

    await waitFor(() => expect(screen.getByText('Dumbbell Bench Press')).toBeInTheDocument());
  });

  it('finishes and returns to Today with what happened', async () => {
    const user = userEvent.setup();
    render(<WorkoutRunnerPage />);

    await user.click(await screen.findByRole('button', { name: 'Finish workout' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(finishedSessions()).toHaveLength(1));
    expect(finishedSessions()[0].status).toBe('COMPLETED');
    expect(mockNavigate).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ state: expect.objectContaining({ notice: expect.any(String) }) }),
    );
  });

  it('records stopping as a different fact from finishing', async () => {
    const user = userEvent.setup();
    render(<WorkoutRunnerPage />);

    await user.click(await screen.findByRole('button', { name: 'Finish workout' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(finishedSessions()[0].status).toBe('ABANDONED'));
  });

  it('says so kindly when the session is gone', async () => {
    seedSession(buildSessionView({ id: 'another-session' }));
    render(<WorkoutRunnerPage />);

    expect(await screen.findByText('This workout is gone')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<WorkoutRunnerPage />);

    await screen.findByTestId('set-inputs');

    expect(
      await axe(container, { rules: { 'color-contrast': { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
