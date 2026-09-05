import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import { seedPathState, makeOutcome, getPathState } from '../mocks/pathHandlers';
import PathPage from '../../pages/PathPage';

// =============================================================================
// The Path screen, over the stateful mock API (#56, epic #33)
// =============================================================================
//
// These drive the REAL hooks against the in-memory store in
// `mocks/pathHandlers.ts`, so a "create outcome" assertion proves the whole
// path — form → api.ts → MSW → refetch → render — rather than that a callback
// fired. The store enforces the same rules the API does, so a test cannot pass
// against behaviour the server would reject.
// =============================================================================

function renderPath() {
  return render(<PathPage />, { wrapperOptions: { user: mockAdminUser, route: '/path' } });
}

describe('PathPage', () => {
  it('renders the Best Self card and all three domain sections', async () => {
    renderPath();

    await waitFor(() => {
      expect(screen.getByTestId('best-self-card')).toBeInTheDocument();
    });

    for (const domain of ['WORK', 'FAMILY', 'HEALTH']) {
      expect(screen.getByTestId(`domain-section-${domain}`)).toBeInTheDocument();
    }
    // Every domain starts at GROW — the API synthesises the ones with no row.
    expect(screen.getByTestId('domain-mode-WORK')).toHaveTextContent('Grow');
  });

  it('asks a question rather than reporting a missing record when Best Self is empty', async () => {
    renderPath();

    await waitFor(() => {
      expect(screen.getByTestId('best-self-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('Who are you becoming?')).toBeInTheDocument();
  });

  it('saves Best Self and shows the review date', async () => {
    const user = userEvent.setup();
    renderPath();

    await waitFor(() => expect(screen.getByTestId('best-self-card')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Edit Best Self' }));

    const dialog = await screen.findByRole('dialog', { name: 'Your Best Self' });
    await user.type(
      within(dialog).getByLabelText(/identity statement/i),
      'Focused, present, healthy',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Focused, present, healthy')).toBeInTheDocument();
    });
    // `lastReviewedAt` is stamped by the server on every replacement.
    expect(screen.getByText(/last reviewed/i)).toBeInTheDocument();
  });

  it('creates an outcome and shows its card under the right domain', async () => {
    const user = userEvent.setup();
    renderPath();

    await waitFor(() => expect(screen.getByTestId('domain-section-HEALTH')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add Health outcome' }));

    const dialog = await screen.findByRole('dialog', { name: 'New Health outcome' });
    await user.type(
      within(dialog).getByLabelText(/what do you want to be true/i),
      'Three strength workouts per week',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const health = screen.getByTestId('domain-section-HEALTH');
      expect(within(health).getByText('Three strength workouts per week')).toBeInTheDocument();
    });

    // In the store, not merely on screen — this is what survives a reload.
    expect(getPathState().outcomes).toHaveLength(1);
    expect(getPathState().outcomes[0].domain).toBe('HEALTH');
  });

  it('refuses to create an outcome with no title, without calling the API', async () => {
    const user = userEvent.setup();
    renderPath();

    await waitFor(() => expect(screen.getByTestId('domain-section-WORK')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add Work outcome' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('A title is required')).toBeInTheDocument();
    expect(getPathState().outcomes).toHaveLength(0);
  });

  it('hides an archived outcome until "Show archived" is on', async () => {
    const user = userEvent.setup();
    seedPathState({
      outcomes: [
        makeOutcome({ title: 'Live outcome' }),
        makeOutcome({ title: 'Old outcome', state: 'ARCHIVED', archivedAt: new Date().toISOString() }),
      ],
    });
    renderPath();

    await waitFor(() => expect(screen.getByText('Live outcome')).toBeInTheDocument());
    expect(screen.queryByText('Old outcome')).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: /show archived/i }));

    await waitFor(() => expect(screen.getByText('Old outcome')).toBeInTheDocument());
    // The state is a WORD on the chip, not a colour alone.
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument();
  });

  it('changes a domain mode and keeps it', async () => {
    const user = userEvent.setup();
    renderPath();

    await waitFor(() => expect(screen.getByTestId('domain-mode-HEALTH')).toBeInTheDocument());
    await user.click(screen.getByTestId('domain-mode-HEALTH'));
    await user.click(await screen.findByRole('menuitem', { name: /Recover/ }));

    await waitFor(() => {
      expect(screen.getByTestId('domain-mode-HEALTH')).toHaveTextContent('Recover');
    });
    expect(getPathState().domainModes.find((m) => m.domain === 'HEALTH')?.mode).toBe('RECOVER');
  });

  it('shows importance as a value a screen reader can read, not only as dots', async () => {
    seedPathState({ outcomes: [makeOutcome({ importance: 4 })] });
    renderPath();

    expect(await screen.findByRole('img', { name: 'Importance 4 of 5' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    seedPathState({ outcomes: [makeOutcome()] });
    const { container } = renderPath();

    await waitFor(() => expect(screen.getByTestId('best-self-card')).toBeInTheDocument());

    expect(await axe(container)).toHaveNoViolations();
  });
});
