import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../../utils/test-utils';
import { MakeItSmallerDialog } from '../../../../components/today/dialogs/MakeItSmallerDialog';
import type { DecompositionProposal } from '../../../../types';

const aiProposal: DecompositionProposal = {
  steps: [
    { title: 'Open the doc', minutes: 5 },
    { title: 'Write the decision statement', minutes: 10 },
  ],
  firstStep: { title: 'Open the doc', minutes: 5 },
  message: 'Start by opening the doc.',
  source: 'ai',
};

const templateProposal: DecompositionProposal = {
  steps: [{ title: 'Open it and do the first 5 minutes', minutes: 5 }],
  firstStep: { title: 'Open it and do the first 5 minutes', minutes: 5 },
  message: 'The coach is unavailable — start with 5 minutes instead.',
  source: 'template',
};

function renderDialog(overrides: Partial<Parameters<typeof MakeItSmallerDialog>[0]> = {}) {
  return render(
    <MakeItSmallerDialog
      open
      title="Draft the storyline"
      proposal={aiProposal}
      isLoading={false}
      error={null}
      onClose={vi.fn()}
      onApply={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

describe('MakeItSmallerDialog', () => {
  it('shows the coach’s message and the steps after the first', () => {
    renderDialog();

    expect(screen.getByText('Start by opening the doc.')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('decompose-steps')).getByText('Write the decision statement'),
    ).toBeInTheDocument();
  });

  // PRD §15: approval that cannot change anything is just a confirm button.
  it('makes the first step editable, and applies what the user edited', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);

    renderDialog({ onApply });

    const field = screen.getByLabelText('First step');
    await user.clear(field);
    await user.type(field, 'Open the doc and write one line');
    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        firstStep: { title: 'Open the doc and write one line', minutes: 5 },
        steps: aiProposal.steps,
      }),
    );
  });

  it('holds the edited first step to the same fifteen-minute cap the model has', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);

    renderDialog({ onApply });

    const minutes = screen.getByLabelText('Minutes');
    await user.clear(minutes);
    await user.type(minutes, '90');
    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(onApply.mock.calls[0][0].firstStep.minutes).toBe(15);
  });

  it('will not apply an empty first step', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByLabelText('First step'));

    expect(screen.getByRole('button', { name: 'Use this' })).toBeDisabled();
  });

  // A stuck user who reached for help should get help, not a status report.
  it('offers a real five-minute move when the coach is unavailable', () => {
    renderDialog({ proposal: templateProposal });

    expect(screen.getByTestId('decompose-template')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Open it and do the first 5 minutes'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeEnabled();
  });

  it('shows a spinner while the coach is thinking, and no stale proposal', () => {
    renderDialog({ isLoading: true, proposal: null });

    expect(screen.getByTestId('decompose-loading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeDisabled();
  });

  it('reports a transport failure rather than pretending', () => {
    renderDialog({ proposal: null, error: 'Network error' });

    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });
});
