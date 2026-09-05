import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { RitualEditor } from '../../../components/family/RitualEditor';
import { seedFamilyState } from '../../mocks/familyHandlers';
import type { Ritual } from '../../../types';

const ritual: Ritual = {
  id: 'ritual-1',
  title: 'Phone-free dinner',
  purpose: 'Be present at the table',
  familyMemberId: null,
  recurrence: { weekdays: [0, 2, 4], time: '18:30', everyNWeeks: 1 },
  idealMinutes: 45,
  minimumMinutes: 10,
  fallbackBehavior: 'Ten phone-free minutes',
  active: true,
  lastMaterializedThrough: null,
  routineId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('RitualEditor', () => {
  it('prefills every field in edit mode', () => {
    render(
      <RitualEditor open initial={ritual} members={[]} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );

    expect(screen.getByTestId('ritual-title')).toHaveValue('Phone-free dinner');
    expect(screen.getByTestId('ritual-ideal')).toHaveValue(45);
    expect(screen.getByTestId('ritual-minimum')).toHaveValue(10);
    expect(screen.getByTestId('ritual-fallback')).toHaveValue('Ten phone-free minutes');
    expect(screen.getByLabelText('Tuesday')).toHaveAttribute('aria-pressed', 'true');
  });

  it('submits the nested body the API takes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RitualEditor open initial={ritual} members={[]} onClose={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId('ritual-save'));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Phone-free dinner',
          recurrence: { weekdays: [0, 2, 4], time: '18:30', everyNWeeks: 1 },
          idealMinutes: 45,
          minimumMinutes: 10,
          fallbackBehavior: 'Ten phone-free minutes',
        }),
      ),
    );
  });

  it('refuses to submit a minimum longer than the ideal', async () => {
    const onSubmit = vi.fn();
    render(<RitualEditor open initial={ritual} members={[]} onClose={vi.fn()} onSubmit={onSubmit} />);

    const minimum = screen.getByTestId('ritual-minimum');
    await userEvent.clear(minimum);
    await userEvent.type(minimum, '90');
    await userEvent.click(screen.getByTestId('ritual-save'));

    expect(await screen.findByText('The minimum cannot be longer than the ideal')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses to submit with no days chosen', async () => {
    const onSubmit = vi.fn();
    render(
      <RitualEditor
        open
        initial={{ ...ritual, recurrence: { ...ritual.recurrence, weekdays: [] } }}
        members={[]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(screen.getByTestId('ritual-save'));

    expect(await screen.findByText('Pick at least one day')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('surfaces a server lint refusal on the title field and blocks the save', async () => {
    const onSubmit = vi.fn();
    render(
      <RitualEditor
        open
        initial={ritual}
        members={[]}
        titleError={{ message: 'Describe what you will do, not how someone else should feel or behave.', match: 'Make Mia happier' }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByText('Describe what you will do, not how someone else should feel or behave.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ritual-title')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('ritual-save')).toBeDisabled();
  });

  it('lints as the user types and offers the coach’s rewrite', async () => {
    render(<RitualEditor open members={[]} onClose={vi.fn()} onSubmit={vi.fn()} />);

    await userEvent.type(screen.getByTestId('ritual-title'), 'Make Mia happier');

    expect(
      await screen.findByText(
        'Describe what you will do, not how someone else should feel or behave.',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();

    // Offered, never applied: clicking fills the field and does not submit.
    const suggest = await screen.findByTestId('ritual-suggest-rewrite');
    await userEvent.click(suggest);

    await waitFor(() =>
      expect(screen.getByTestId('ritual-title')).toHaveValue('Read with Mia for 15 minutes'),
    );
  });

  it('shows the refusal without a rewrite button when the coach is unavailable', async () => {
    seedFamilyState({ suggestion: null });
    render(<RitualEditor open members={[]} onClose={vi.fn()} onSubmit={vi.fn()} />);

    await userEvent.type(screen.getByTestId('ritual-title'), 'Make Mia happier');

    expect(
      await screen.findByText(
        'Describe what you will do, not how someone else should feel or behave.',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ritual-suggest-rewrite')).not.toBeInTheDocument();
  });

  it('keeps the values when the save fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network unreachable'));
    render(<RitualEditor open initial={ritual} members={[]} onClose={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId('ritual-save'));

    expect(await screen.findByText('Network unreachable')).toBeInTheDocument();
    expect(screen.getByTestId('ritual-title')).toHaveValue('Phone-free dinner');
  });
});
