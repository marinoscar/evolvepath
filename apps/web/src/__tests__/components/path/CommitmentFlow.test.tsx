import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { render, mockAdminUser } from '../../utils/test-utils';
import { getPathState, makeOutcome, seedPathState } from '../../mocks/pathHandlers';
import OutcomeDetailPage from '../../../pages/OutcomeDetailPage';
import type { Commitment } from '../../../types';

// =============================================================================
// The commitment lifecycle, from the screen (#56, epic #33)
// =============================================================================
//
// The distinction this file exists to hold: COMPLETION IS A STATUS, EVIDENCE IS
// A FACT THE USER ASSERTED. Completing with a note produces one USER_LOG row;
// completing with an empty dialog produces none. PRD §10.9 forbids the product
// from claiming something happened that nobody said happened, and a dialog
// that always wrote evidence would do exactly that.
// =============================================================================

function renderDetail(outcomeId: string) {
  return render(
    <Routes>
      <Route path="/path/outcomes/:id" element={<OutcomeDetailPage />} />
    </Routes>,
    { wrapperOptions: { user: mockAdminUser, route: `/path/outcomes/${outcomeId}` } },
  );
}

/** A commitment scheduled tomorrow — inside the page's 14-day window. */
function commitment(overrides: Partial<Commitment> = {}): Commitment {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + 45 * 60 * 1000);

  return {
    id: 'commitment-1',
    domain: 'HEALTH',
    title: 'Upper A',
    outcomeId: 'outcome-1',
    planVersionId: null,
    routineId: null,
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    importance: 4,
    commitmentType: null,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: '10-minute circuit',
    status: 'PLANNED',
    allowedTransitions: [],
    rescheduleCount: 0,
    rescheduledFromId: null,
    rescheduledToId: null,
    skipReason: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    evidenceCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function seedWithCommitment(overrides: Partial<Commitment> = {}) {
  const outcome = makeOutcome({ id: 'outcome-1' });
  seedPathState({ outcomes: [outcome], commitments: [commitment(overrides)] });
  return outcome;
}

describe('commitment lifecycle', () => {
  it('offers exactly the transitions the API allows, and no others', async () => {
    const user = userEvent.setup();
    const outcome = seedWithCommitment();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: /change status of Upper A/i }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Ready',
      'Start',
      'Reschedule',
      'Skip',
      'Missed',
      'Cancel',
    ]);
    // Not offered from PLANNED — the matrix says a commitment must be started
    // before it can be completed.
    expect(within(menu).queryByText('Complete')).not.toBeInTheDocument();
  });

  it('starts without a dialog, because there is nothing to ask', async () => {
    const user = userEvent.setup();
    const outcome = seedWithCommitment();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: /change status of Upper A/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Start' }));

    await waitFor(() => {
      expect(getPathState().commitments[0].status).toBe('STARTED');
    });
    expect(getPathState().commitments[0].startedAt).not.toBeNull();
  });

  it('completes with a note and records one USER_LOG evidence row', async () => {
    const user = userEvent.setup();
    const outcome = seedWithCommitment({ status: 'STARTED', startedAt: new Date().toISOString() });
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: /change status of Upper A/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Complete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Log what happened' });
    await user.type(within(dialog).getByLabelText(/how did it go/i), 'Finished all sets');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPathState().evidence).toHaveLength(1);
    });
    expect(getPathState().evidence[0].source).toBe('USER_LOG');
    expect(getPathState().evidence[0].qualitativeValue).toBe('Finished all sets');

    await waitFor(() => {
      expect(screen.getByText('1 evidence · USER_LOG')).toBeInTheDocument();
    });
  });

  // The other half of the same rule, and the easy one to get wrong.
  it('completes with an empty dialog and records NO evidence', async () => {
    const user = userEvent.setup();
    const outcome = seedWithCommitment({ status: 'STARTED', startedAt: new Date().toISOString() });
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: /change status of Upper A/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Complete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Log what happened' });
    // The helper line that promises this behaviour.
    expect(
      within(dialog).getByText('Leave empty to record the status without evidence.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getPathState().commitments[0].status).toBe('COMPLETED');
    });
    expect(getPathState().evidence).toHaveLength(0);
  });

  it('reschedules into a new PLANNED row that carries the count', async () => {
    const user = userEvent.setup();
    const outcome = seedWithCommitment();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: /change status of Upper A/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reschedule' }));

    const dialog = await screen.findByRole('dialog');
    const later = new Date();
    later.setDate(later.getDate() + 3);
    later.setSeconds(0, 0);
    const localValue = new Date(later.getTime() - later.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);

    await user.type(within(dialog).getByLabelText(/move it to/i), localValue);
    await user.click(within(dialog).getByRole('button', { name: 'Reschedule' }));

    await waitFor(() => {
      expect(getPathState().commitments).toHaveLength(2);
    });

    const [original, replacement] = getPathState().commitments;
    expect(original.status).toBe('RESCHEDULED');
    expect(replacement.status).toBe('PLANNED');
    // The count travels with the INTENTION, not the closed row — E07's
    // avoidance detection reads it off the live commitment.
    expect(replacement.rescheduleCount).toBe(1);
    expect(replacement.rescheduledFromId).toBe(original.id);

    await waitFor(() => {
      expect(screen.getByText('rescheduled ×1')).toBeInTheDocument();
    });
  });

  it('requires a new time before a reschedule is sent', async () => {
    const user = userEvent.setup();
    const outcome = seedWithCommitment();
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: /change status of Upper A/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reschedule' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reschedule' }));

    expect(await within(dialog).findByText('Pick a new time')).toBeInTheDocument();
    expect(getPathState().commitments).toHaveLength(1);
  });

  it('offers nothing on a terminal commitment', async () => {
    const outcome = seedWithCommitment({ status: 'COMPLETED' });
    renderDetail(outcome.id);

    const chip = await screen.findByRole('button', { name: /change status of Upper A/i });
    // The API's `allowedTransitions` is empty, so there is no menu to open.
    expect(chip).toHaveAttribute('aria-disabled', 'true');
  });

  it('adds a commitment from the form', async () => {
    const user = userEvent.setup();
    const outcome = makeOutcome({ id: 'outcome-1' });
    seedPathState({ outcomes: [outcome] });
    renderDetail(outcome.id);

    await user.click(await screen.findByRole('button', { name: 'Add commitment' }));

    const dialog = await screen.findByRole('dialog', { name: 'New commitment' });
    await user.type(within(dialog).getByLabelText(/what will you do/i), 'Upper A');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(getPathState().commitments).toHaveLength(1);
    });
    expect(getPathState().commitments[0].outcomeId).toBe(outcome.id);
    // Sent as an instant, not as the input's wall-clock text.
    expect(getPathState().commitments[0].scheduledStart).toMatch(/Z$/);
  });
});
