import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';
import { Route, Routes } from 'react-router-dom';

import { render, mockAdminUser } from '../utils/test-utils';
import { getPathState, makeOutcome, seedPathState } from '../mocks/pathHandlers';
import OutcomeDetailPage from '../../pages/OutcomeDetailPage';

// =============================================================================
// The outcome detail page — the plan versioning contract, end to end (#56)
// =============================================================================
//
// PRD §80/§103 want the user to be able to see WHY the plan changed, with both
// sides of the change still readable. That is a claim about two rows at once,
// and it is what most of this file asserts: creating v2 leaves v1 intact,
// activating v2 marks v1 SUPERSEDED, and v1's routines stay viewable in the
// history afterwards.
// =============================================================================

/** Renders at the real route so `useParams` resolves the id. */
function renderDetail(outcomeId: string) {
  return render(
    <Routes>
      <Route path="/path/outcomes/:id" element={<OutcomeDetailPage />} />
    </Routes>,
    { wrapperOptions: { user: mockAdminUser, route: `/path/outcomes/${outcomeId}` } },
  );
}

/** An outcome with a plan whose v1 is active and carries one routine. */
function seedPlannedOutcome() {
  const outcome = makeOutcome({ title: 'Three strength workouts per week' });
  seedPathState({
    outcomes: [outcome],
    plans: [
      {
        id: 'plan-1',
        outcomeId: outcome.id,
        activeVersion: null,
        versionCount: 1,
        createdAt: new Date().toISOString(),
      },
    ],
    versions: [
      {
        id: 'version-1',
        planId: 'plan-1',
        version: 1,
        status: 'ACTIVE',
        rationale: 'Start with mornings',
        expectedWeeklyLoad: 120,
        fallbackStrategy: null,
        createdBy: 'USER',
        userApproved: true,
        previousVersionId: null,
        activeFrom: new Date().toISOString(),
        activeUntil: null,
        routineCount: 1,
        createdAt: new Date().toISOString(),
        routines: [],
      },
    ],
    routines: [
      {
        id: 'routine-1',
        planVersionId: 'version-1',
        title: 'Morning workout',
        domain: 'HEALTH',
        triggerType: 'EVENT',
        triggerValue: 'morning coffee',
        frequency: 'WEEKDAYS',
        daysOfWeek: [],
        preferredTime: '06:30',
        estimatedDurationMin: 45,
        minimumDurationMin: 10,
        fallbackBehavior: '10-minute circuit',
        active: true,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  return outcome;
}

describe('OutcomeDetailPage', () => {
  it('shows a dead end with a way back for an unknown id, never a redirect', async () => {
    // The API answers 404 for an id that never existed AND for one belonging
    // to someone else — deliberately indistinguishable. Bouncing to /path
    // would make a mistyped URL look like a working one.
    renderDetail('outcome-that-does-not-exist');

    expect(await screen.findByText('Outcome not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Path' })).toHaveAttribute('href', '/path');
  });

  it('offers to create a plan when there is none', async () => {
    const outcome = makeOutcome();
    seedPathState({ outcomes: [outcome] });
    renderDetail(outcome.id);

    expect(await screen.findByText('No plan yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create plan' })).toBeInTheDocument();
  });

  it('creates a plan whose v1 is active', async () => {
    const user = userEvent.setup();
    const outcome = makeOutcome();
    seedPathState({ outcomes: [outcome] });
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: 'Create plan' }));

    const dialog = await screen.findByRole('dialog', { name: 'Create plan' });
    await user.type(
      within(dialog).getByLabelText(/how are you going to approach this/i),
      'Start with mornings',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Create plan' }));

    await waitFor(() => {
      expect(within(screen.getByTestId('plan-summary')).getByText('Plan v1')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('plan-summary')).getByText('ACTIVE')).toBeInTheDocument();
  });

  it('requires a rationale before drafting a new version', async () => {
    const user = userEvent.setup();
    const outcome = seedPlannedOutcome();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: 'New version' }));

    const dialog = await screen.findByRole('dialog', { name: 'Why is the plan changing?' });
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    // PRD §80: the moment the user knew why has passed by the time anybody
    // notices it is missing, so the form refuses before the request is sent.
    expect(
      await within(dialog).findByText(/a reason is required/i),
    ).toBeInTheDocument();
    expect(getPathState().versions).toHaveLength(1);
  });

  it('drafts v2 with its rationale visible, leaving v1 untouched', async () => {
    const user = userEvent.setup();
    const outcome = seedPlannedOutcome();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: 'New version' }));

    const dialog = await screen.findByRole('dialog', { name: 'Why is the plan changing?' });
    await user.type(
      within(dialog).getByLabelText(/reason for the change/i),
      'Evenings kept slipping',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(screen.getByTestId('plan-version-2')).toBeInTheDocument();
    });

    const v2 = screen.getByTestId('plan-version-2');
    expect(within(v2).getByText('DRAFT')).toBeInTheDocument();
    // The rationale IS the history — shown in full on the row itself.
    expect(within(v2).getByText('Evenings kept slipping')).toBeInTheDocument();

    // v1 is still there, still active, and still has its routine: the "before"
    // side of the change survives, which is the half PRD §103 asks for.
    const v1 = screen.getByTestId('plan-version-1');
    expect(within(v1).getByText('ACTIVE')).toBeInTheDocument();
    expect(within(v1).getByText('Start with mornings')).toBeInTheDocument();

    // The routines were CLONED, not moved.
    expect(getPathState().routines.filter((r) => r.planVersionId === 'version-1')).toHaveLength(1);
    expect(getPathState().routines).toHaveLength(2);
  });

  it('activates a draft, superseding the previous version', async () => {
    const user = userEvent.setup();
    const outcome = seedPlannedOutcome();
    seedPathState({
      versions: [
        ...getPathState().versions,
        {
          id: 'version-2',
          planId: 'plan-1',
          version: 2,
          status: 'DRAFT',
          rationale: 'Evenings kept slipping',
          expectedWeeklyLoad: 150,
          fallbackStrategy: null,
          createdBy: 'USER',
          userApproved: false,
          previousVersionId: 'version-1',
          activeFrom: null,
          activeUntil: null,
          routineCount: 0,
          createdAt: new Date().toISOString(),
          routines: [],
        },
      ],
    });
    renderDetail(outcome.id);

    // Expanding the row is what reveals its Activate button.
    const v2 = await screen.findByTestId('plan-version-2');
    await user.click(within(v2).getByRole('button', { name: /Version 2, DRAFT/ }));
    await user.click(await within(v2).findByRole('button', { name: 'Activate v2' }));

    await waitFor(() => {
      expect(getPathState().versions.find((v) => v.version === 1)?.status).toBe('SUPERSEDED');
    });
    expect(getPathState().versions.find((v) => v.version === 2)?.status).toBe('ACTIVE');

    await waitFor(() => {
      expect(within(screen.getByTestId('plan-summary')).getByText('Plan v2')).toBeInTheDocument();
    });
    // v1 is still readable, now marked as history with an end date.
    const v1 = screen.getByTestId('plan-version-1');
    expect(within(v1).getByText('SUPERSEDED')).toBeInTheDocument();
    expect(within(v1).getByText(/until/)).toBeInTheDocument();
  });

  it('lists the active version\'s routines and adds one', async () => {
    const user = userEvent.setup();
    const outcome = seedPlannedOutcome();
    renderDetail(outcome.id);

    expect(await screen.findByText('Morning workout')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add routine' }));
    const dialog = await screen.findByRole('dialog', { name: 'New routine' });
    await user.type(within(dialog).getByLabelText(/what will you do/i), 'Evening walk');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Evening walk')).toBeInTheDocument());
  });

  it('refuses a routine whose minimum is longer than its full version', async () => {
    const user = userEvent.setup();
    const outcome = seedPlannedOutcome();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: 'Add routine' }));
    const dialog = await screen.findByRole('dialog', { name: 'New routine' });

    await user.type(within(dialog).getByLabelText(/what will you do/i), 'Bad routine');
    const minimum = within(dialog).getByLabelText(/minimum version/i);
    await user.clear(minimum);
    await user.type(minimum, '90');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    // The bad-day path must not be the harder one (PRD §57). Caught before any
    // request is sent — the routine count is unchanged.
    expect(
      await within(dialog).findByText(/minimum cannot be longer than the full version/i),
    ).toBeInTheDocument();
    expect(getPathState().routines).toHaveLength(1);
  });

  it('refuses a CUSTOM frequency with no days chosen', async () => {
    const user = userEvent.setup();
    const outcome = seedPlannedOutcome();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: 'Add routine' }));
    const dialog = await screen.findByRole('dialog', { name: 'New routine' });

    await user.type(within(dialog).getByLabelText(/what will you do/i), 'Custom routine');
    await user.click(within(dialog).getByLabelText(/how often/i));
    await user.click(await screen.findByRole('option', { name: 'Specific days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('Pick at least one day')).toBeInTheDocument();
    expect(getPathState().routines).toHaveLength(1);
  });

  it('locks everything down for an archived outcome', async () => {
    const outcome = makeOutcome({
      state: 'ARCHIVED',
      archivedAt: new Date().toISOString(),
    });
    seedPathState({ outcomes: [outcome] });
    renderDetail(outcome.id);

    expect(await screen.findByText(/this outcome is archived/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create plan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add commitment' })).toBeDisabled();
  });

  it('has no axe violations', async () => {
    const outcome = seedPlannedOutcome();
    const { container } = renderDetail(outcome.id);

    await waitFor(() => expect(screen.getByTestId('plan-summary')).toBeInTheDocument());

    expect(await axe(container)).toHaveNoViolations();
  });
});
