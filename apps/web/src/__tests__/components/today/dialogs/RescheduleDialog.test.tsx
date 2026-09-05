import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../../utils/test-utils';
import { RescheduleDialog } from '../../../../components/today/dialogs/RescheduleDialog';
import type { CommitmentCard } from '../../../../types';

const commitment = {
  id: 'c1',
  title: 'Upper A',
  scheduledStart: '2026-03-02T18:00:00.000Z',
} as CommitmentCard;

describe('RescheduleDialog', () => {
  // Most reschedules are "not today, but still a real plan"; a blank field would
  // make the user re-decide something they already decided.
  it('defaults to tomorrow at the same time', () => {
    render(
      <RescheduleDialog
        open
        commitment={commitment}
        onClose={vi.fn()}
        onReschedule={vi.fn()}
      />,
    );

    const expected = new Date('2026-03-02T18:00:00.000Z');
    expected.setDate(expected.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const value = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(
      expected.getDate(),
    )}T${pad(expected.getHours())}:${pad(expected.getMinutes())}`;

    expect(screen.getByLabelText('New time')).toHaveValue(value);
  });

  it('posts an ISO instant, not the local string the input holds', async () => {
    const user = userEvent.setup();
    const onReschedule = vi.fn().mockResolvedValue(undefined);

    render(
      <RescheduleDialog
        open
        commitment={commitment}
        onClose={vi.fn()}
        onReschedule={onReschedule}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Move it' }));

    const [{ scheduledStart }] = onReschedule.mock.calls[0];
    expect(scheduledStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  // The count on the new row is what E07 later reads back to them.
  it('says what moving actually does', () => {
    render(
      <RescheduleDialog
        open
        commitment={commitment}
        onClose={vi.fn()}
        onReschedule={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/closes today’s commitment and opens a new one/i),
    ).toBeInTheDocument();
  });

  it('stays open when the server refuses', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <RescheduleDialog
        open
        commitment={commitment}
        onClose={onClose}
        onReschedule={vi.fn().mockRejectedValue(new Error('nope'))}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Move it' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
