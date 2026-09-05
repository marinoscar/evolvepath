import { beforeEach, describe, it, expect } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { setViewportWidth } from '../../setup';
import { makePlan, seedPlan, weeklyState, SOFT_CAP } from '../../mocks/weeklyHandlers';
import WeeklyPlanWizard from '../../../components/weekly/WeeklyPlanWizard';
import { useWeeklyPlan } from '../../../hooks/useWeeklyPlan';

// =============================================================================
// The planning wizard (issue #84)
// =============================================================================
//
// Driven through the REAL hook against the stateful handlers, not with stub
// callbacks: the properties worth holding here are all about what reaches the
// server — that each step persists before advancing, that entering the
// commitments step asks the API what the week is rather than computing it, and
// that approve cannot be pressed until the user has read the warning.
// =============================================================================

const PHONE = 390;
const DESKTOP = 1280;

/** The page's wiring, minus the chrome. */
function Harness() {
  const { plan, isSaving, update, propose, approve } = useWeeklyPlan();

  if (!plan) return <div>loading</div>;

  return (
    <WeeklyPlanWizard
      plan={plan}
      saving={isSaving}
      onUpdate={update}
      onPropose={propose}
      onApprove={async (ack) => {
        await approve(ack);
      }}
    />
  );
}

const next = () => screen.getByTestId('wizard-next');

async function advanceTo(step: number, user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < step; i += 1) {
    await user.click(next());
    // Each step round-trips through the API before the next one renders.
    await waitFor(() => expect(next()).toBeEnabled());
  }
}

describe('WeeklyPlanWizard (#84)', () => {
  beforeEach(() => {
    act(() => setViewportWidth(DESKTOP));
    seedPlan();
  });

  it('persists each step before advancing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('weekly-plan-wizard');

    // Step 1: constraints.
    await user.click(screen.getByRole('button', { name: /Mon/ }));
    await user.click(next());

    await waitFor(() =>
      expect(weeklyState().patches[0]).toMatchObject({
        constraints: expect.objectContaining({ travelDays: ['2026-09-07'] }),
      }),
    );

    // Step 2: focus.
    await user.type(screen.getByTestId('wizard-focus'), 'Ship the proposal draft');
    await user.click(next());

    await waitFor(() =>
      expect(weeklyState().patches[1]).toEqual({
        primaryFocus: 'Ship the proposal draft',
      }),
    );

    // Step 3: domain modes. Scoped to the group — there is one Maintain button
    // per domain, and picking the first by accident would assert nothing.
    await user.click(
      within(screen.getByRole('group', { name: 'Work' })).getByRole('button', {
        name: 'Maintain',
      }),
    );
    await user.click(next());

    await waitFor(() =>
      expect(weeklyState().patches[2]).toMatchObject({
        domainModes: expect.objectContaining({ WORK: 'MAINTAIN' }),
      }),
    );
  });

  it('asks the API what next week is when the commitments step opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('weekly-plan-wizard');

    expect(weeklyState().proposeCalls).toHaveLength(0);

    await advanceTo(3, user);

    // The wizard never computes the week itself: two implementations of "how
    // many commitments is this" is two answers.
    await waitFor(() => expect(weeklyState().proposeCalls).toHaveLength(1));
    expect(await screen.findByTestId('wizard-load-summary')).toBeInTheDocument();
  });

  it('re-proposes with the extras when one is added', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('weekly-plan-wizard');
    await advanceTo(3, user);
    await screen.findByTestId('wizard-add-commitment');

    await user.click(screen.getByTestId('wizard-add-commitment'));
    await user.type(
      screen.getByLabelText('What are you committing to?'),
      'Reading block',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      const last = weeklyState().proposeCalls.at(-1);
      expect(last?.extras).toHaveLength(1);
      expect(last?.extras[0].title).toBe('Reading block');
    });
  });

  it('raises the load warning once past the cap, and gates approve on it', async () => {
    const user = userEvent.setup();
    // Two routines already; the cap is reached by adding enough recurring
    // extras to exceed it, read from the mock rather than hard-coded.
    seedPlan(makePlan());
    render(<Harness />);
    await screen.findByTestId('weekly-plan-wizard');
    await advanceTo(3, user);
    await screen.findByTestId('wizard-add-commitment');

    for (let i = 0; i < SOFT_CAP - 1; i += 1) {
      await user.click(screen.getByTestId('wizard-add-commitment'));
      await user.type(
        screen.getByLabelText('What are you committing to?'),
        `Extra ${i}`,
      );
      await user.click(
        screen.getByLabelText('This is a habit I want to repeat'),
      );
      await user.click(screen.getByRole('button', { name: 'Add' }));
      await waitFor(() =>
        expect(weeklyState().proposeCalls.at(-1)?.extras).toHaveLength(i + 1),
      );
    }

    const alert = await screen.findByTestId('wizard-load-warning');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(`${SOFT_CAP + 1} recurring commitments`);

    await user.click(next());

    const approve = await screen.findByTestId('wizard-approve');
    expect(approve).toBeDisabled();

    await user.click(screen.getByTestId('wizard-ack-warnings'));
    expect(approve).toBeEnabled();

    await user.click(approve);
    await waitFor(() =>
      expect(weeklyState().approveCalls.at(-1)).toEqual({ acknowledgeWarnings: true }),
    );
  });

  it('approves without acknowledgement when there is nothing to acknowledge', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('weekly-plan-wizard');
    await advanceTo(3, user);
    await screen.findByTestId('wizard-add-commitment');
    await user.click(next());

    const approve = await screen.findByTestId('wizard-approve');
    expect(screen.queryByTestId('wizard-ack-warnings')).not.toBeInTheDocument();
    expect(approve).toBeEnabled();

    await user.click(approve);
    await waitFor(() =>
      expect(weeklyState().approveCalls.at(-1)).toEqual({ acknowledgeWarnings: false }),
    );
  });

  it('keeps only one step mounted on a phone', async () => {
    // MUI's Collapse keeps its children mounted by default, so a vertical
    // stepper without `unmountOnExit` leaves every collapsed step's Next button
    // in the DOM and in the tab order — five buttons with the same purpose,
    // four of them invisible and reachable by keyboard.
    act(() => setViewportWidth(PHONE));
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('weekly-plan-wizard');

    expect(screen.getAllByTestId('wizard-next')).toHaveLength(1);

    await user.click(next());
    await waitFor(() => expect(screen.getAllByTestId('wizard-next')).toHaveLength(1));
  });

  it('is a vertical stepper below sm and horizontal above', async () => {
    act(() => setViewportWidth(PHONE));
    const { unmount } = render(<Harness />);

    expect(await screen.findByTestId('weekly-plan-wizard')).toHaveClass(
      'MuiStepper-vertical',
    );

    unmount();
    act(() => setViewportWidth(DESKTOP));
    render(<Harness />);

    expect(await screen.findByTestId('weekly-plan-wizard')).toHaveClass(
      'MuiStepper-horizontal',
    );
  });
});
