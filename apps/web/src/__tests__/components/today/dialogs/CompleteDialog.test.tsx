import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../../utils/test-utils';
import { CompleteDialog } from '../../../../components/today/dialogs/CompleteDialog';
import type { CommitmentCard } from '../../../../types';

const commitment = { id: 'c1', title: 'Draft the storyline' } as CommitmentCard;

function renderDialog(overrides: Partial<Parameters<typeof CompleteDialog>[0]> = {}) {
  return render(
    <CompleteDialog
      open
      commitment={commitment}
      onClose={vi.fn()}
      onComplete={vi.fn().mockResolvedValue(undefined)}
      onPartial={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

describe('CompleteDialog', () => {
  // Both are legitimate endings (PRD §101); making the user categorise first
  // and then confirm would put a step between them and the honest answer.
  it('offers "done" and "partly done" as two direct buttons', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Partly done' })).toBeInTheDocument();
  });

  it('submits with nothing filled in', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(undefined);

    renderDialog({ onComplete });

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onComplete).toHaveBeenCalledWith({ notes: null, minutesSpent: null });
  });

  it('passes the notes and the minutes the user gave', async () => {
    const user = userEvent.setup();
    const onPartial = vi.fn().mockResolvedValue(undefined);

    renderDialog({ onPartial });

    await user.type(screen.getByLabelText('Notes'), 'got the intro down');
    await user.type(screen.getByLabelText('Minutes spent'), '15');
    await user.click(screen.getByRole('button', { name: 'Partly done' }));

    expect(onPartial).toHaveBeenCalledWith({
      notes: 'got the intro down',
      minutesSpent: 15,
    });
  });

  // Pre-filling a number would invite the user to accept a figure they did not
  // check; the server derives it from the timer instead.
  it('leaves the minutes blank and says why', () => {
    renderDialog();

    expect(screen.getByLabelText('Minutes spent')).toHaveValue(null);
    expect(screen.getByText(/use the timer’s own count/)).toBeInTheDocument();
  });

  it('stays open and keeps the notes when the server refuses', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderDialog({ onClose, onComplete: vi.fn().mockRejectedValue(new Error('nope')) });

    await user.type(screen.getByLabelText('Notes'), 'worth keeping');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('worth keeping')).toBeInTheDocument();
  });
});
