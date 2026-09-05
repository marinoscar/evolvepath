import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../../utils/test-utils';
import { SkipDialog } from '../../../../components/today/dialogs/SkipDialog';
import type { CommitmentCard } from '../../../../types';

const commitment = { id: 'c1', title: 'Phone-free dinner' } as CommitmentCard;

describe('SkipDialog', () => {
  // PRD P5: a failed plan is information, and a skip with no reason is the one
  // thing the product cannot learn anything from.
  it('will not submit without a reason', async () => {
    render(
      <SkipDialog open commitment={commitment} onClose={vi.fn()} onSkip={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Skip it' })).toBeDisabled();
  });

  it('posts the reason and the optional note', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <SkipDialog open commitment={commitment} onClose={onClose} onSkip={onSkip} />,
    );

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Unexpected conflict' }));
    await user.type(within(dialog).getByLabelText(/Anything else/), 'in-laws visiting');
    await user.click(within(dialog).getByRole('button', { name: 'Skip it' }));

    expect(onSkip).toHaveBeenCalledWith({
      reason: 'UNEXPECTED_CONFLICT',
      text: 'in-laws visiting',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends null rather than an empty string when nothing was typed', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn().mockResolvedValue(undefined);

    render(
      <SkipDialog open commitment={commitment} onClose={vi.fn()} onSkip={onSkip} />,
    );

    await user.click(screen.getByRole('radio', { name: 'I avoided it' }));
    await user.click(screen.getByRole('button', { name: 'Skip it' }));

    expect(onSkip).toHaveBeenCalledWith({ reason: 'AVOIDED', text: null });
  });

  // Naming avoidance is what lets E07 do anything about it later.
  it('offers "I avoided it" as a first-class answer', () => {
    render(
      <SkipDialog open commitment={commitment} onClose={vi.fn()} onSkip={vi.fn()} />,
    );

    expect(screen.getByRole('radio', { name: 'I avoided it' })).toBeInTheDocument();
  });

  it('stays open and keeps the note when the server refuses', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn().mockRejectedValue(new Error('nope'));
    const onClose = vi.fn();

    render(
      <SkipDialog open commitment={commitment} onClose={onClose} onSkip={onSkip} />,
    );

    await user.click(screen.getByRole('radio', { name: 'Bad timing' }));
    await user.type(screen.getByLabelText(/Anything else/), 'ran out of time');
    await user.click(screen.getByRole('button', { name: 'Skip it' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('ran out of time')).toBeInTheDocument();
  });
});
