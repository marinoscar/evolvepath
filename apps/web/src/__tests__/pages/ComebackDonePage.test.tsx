import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import {
  comebackCompletions,
  setComebackStatus,
} from '../mocks/comebackHandlers';
import { setMilestones } from '../mocks/progressHandlers';
import ComebackDonePage from '../../pages/ComebackDonePage';

// =============================================================================
// "Back on Path." (issue #119, epic E11)
// =============================================================================
//
// The property this file exists to hold: A RELOAD IS NOT A FAILURE. The API is
// idempotent by refusal — the second complete is a 409 — so this page has to
// treat that as "already done" and still show the celebration. A page that
// rendered an error there would tell somebody their recovery did not count.
// =============================================================================

function CoachStub() {
  const location = useLocation();
  return <div data-testid="coach-screen">{JSON.stringify(location.state)}</div>;
}

function renderDone() {
  return render(
    <Routes>
      <Route path="/comeback/done" element={<ComebackDonePage />} />
      <Route path="/coach" element={<CoachStub />} />
      <Route path="/" element={<div data-testid="today-screen" />} />
    </Routes>,
    { wrapperOptions: { route: '/comeback/done' } },
  );
}

describe('ComebackDonePage (#119)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('records the return exactly once and says the sentence', async () => {
    renderDone();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Back on Path.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The important part was not that you missed. It was that you returned.',
      ),
    ).toBeInTheDocument();
    expect(comebackCompletions()).toBe(1);
  });

  it('celebrates the first comeback here, and acknowledges it so /progress does not repeat it', async () => {
    setMilestones([
      {
        id: 'm-1',
        kind: 'FIRST_COMEBACK',
        sequence: 1,
        domain: null,
        achievedAt: '2026-03-06T14:00:00.000Z',
        acknowledgedAt: null,
        title: 'First comeback',
        body: 'You returned.',
        meta: {},
      },
    ]);

    renderDone();
    await screen.findByRole('heading', { level: 1, name: 'Back on Path.' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('First comeback');

    // The ack is what stops the Progress toast showing the same milestone.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('shows the next planned commitment', async () => {
    renderDone();
    await screen.findByRole('heading', { level: 1, name: 'Back on Path.' });

    expect(screen.getByText('Next up')).toBeInTheDocument();
    expect(screen.getByText('Morning focus block')).toBeInTheDocument();
  });

  it('treats a 409 on reload as "already done", not as an error', async () => {
    // The loop is already closed: exactly the state a refresh produces.
    setComebackStatus({ state: 'NONE', restart: null });

    renderDone();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Back on Path.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(comebackCompletions()).toBe(0);
  });

  it('offers a plan review only when the API asked for one', async () => {
    renderDone();
    await screen.findByRole('heading', { level: 1, name: 'Back on Path.' });

    expect(
      screen.queryByRole('button', { name: 'Review my plan' }),
    ).not.toBeInTheDocument();
  });

  it('goes back to Today', async () => {
    const user = userEvent.setup();
    renderDone();
    await screen.findByRole('heading', { level: 1, name: 'Back on Path.' });

    await user.click(screen.getByRole('button', { name: 'Back to Today' }));

    expect(await screen.findByTestId('today-screen')).toBeInTheDocument();
  });

  it('puts focus on the celebration', async () => {
    renderDone();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Back on Path.' });

    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('has no accessibility violations', async () => {
    const { container } = renderDone();
    await screen.findByRole('heading', { level: 1, name: 'Back on Path.' });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ComebackDonePage when a plan review is suggested (#119)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('opens the coach with the “I fell off” prompt', async () => {
    const user = userEvent.setup();
    // The completion payload carries the flag; the mock's default says false,
    // so this case is driven by seeding the stored payload a reload would read.
    sessionStorage.setItem(
      'comeback.done',
      JSON.stringify({
        celebration: { title: 'Back on Path.', body: '' },
        evidenceId: 'e1',
        milestone: null,
        nextCommitment: null,
        planReviewSuggested: true,
      }),
    );
    setComebackStatus({ state: 'NONE', restart: null });

    render(
      <Routes>
        <Route path="/comeback/done" element={<ComebackDonePage />} />
        <Route path="/coach" element={<CoachStub />} />
      </Routes>,
      { wrapperOptions: { route: '/comeback/done' } },
    );

    await user.click(await screen.findByRole('button', { name: 'Review my plan' }));

    const coach = await screen.findByTestId('coach-screen');
    expect(within(coach).getByText(/I fell off/)).toBeInTheDocument();
  });
});
