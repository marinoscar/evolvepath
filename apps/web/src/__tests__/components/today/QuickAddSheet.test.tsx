import { describe, it, expect, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { setViewportWidth } from '../../setup';
import { QuickAddSheet } from '../../../components/today/QuickAddSheet';
import type { CommitmentCard, Outcome } from '../../../types';

const PHONE = 375;
const DESKTOP = 1024;

const outcome = {
  id: '11111111-1111-4111-8111-111111111111',
  domain: 'WORK',
  title: 'Ship the Q4 proposal',
} as Outcome;

function renderSheet(overrides: Partial<Parameters<typeof QuickAddSheet>[0]> = {}) {
  return render(
    <QuickAddSheet
      open
      outcomes={[outcome]}
      submitting={false}
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

describe('QuickAddSheet', () => {
  describe('the container', () => {
    // A local presentation choice — which container ONE component renders in —
    // and deliberately not a sixth entry in the shell's five coupled gates.
    it('is a bottom sheet on a phone', () => {
      act(() => setViewportWidth(PHONE));
      renderSheet();

      expect(screen.getByTestId('quick-add-drawer')).toBeInTheDocument();
      expect(screen.queryByTestId('quick-add-dialog')).not.toBeInTheDocument();
    });

    it('is a centred dialog from 600px up', () => {
      act(() => setViewportWidth(DESKTOP));
      renderSheet();

      expect(screen.getByTestId('quick-add-dialog')).toBeInTheDocument();
      expect(screen.queryByTestId('quick-add-drawer')).not.toBeInTheDocument();
    });
  });

  describe('the kind chooser', () => {
    it('offers the four kinds PRD §12.1 names', () => {
      renderSheet();

      const kinds = screen.getByTestId('quick-add-kinds');
      expect(within(kinds).getByRole('button', { name: /Commitment/ })).toBeEnabled();
      expect(within(kinds).getByRole('button', { name: /Work action/ })).toBeEnabled();
      expect(within(kinds).getByRole('button', { name: /Family intention/ })).toBeEnabled();
    });

    // Rendered and disabled rather than omitted: a user who looks for it should
    // learn that it is coming, not conclude it does not exist.
    it('shows Workout as coming rather than hiding it', () => {
      renderSheet();

      const workout = screen.getByRole('button', { name: /Workout/ });
      expect(workout).toBeDisabled();
      expect(workout).toHaveTextContent('Coming with workout programs');
    });

    it('preselects FAMILY for a family intention', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.click(screen.getByRole('button', { name: /Family intention/ }));

      expect(screen.getByRole('button', { name: 'Family', pressed: true })).toBeInTheDocument();
    });

    it('preselects WORK for a work action', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.click(screen.getByRole('button', { name: /Work action/ }));

      expect(screen.getByRole('button', { name: 'Work', pressed: true })).toBeInTheDocument();
    });

    it('leaves the domain on the user for a plain commitment', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.click(screen.getByRole('button', { name: /^Commitment/ }));

      expect(screen.getByRole('button', { name: 'Work', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Family' })).toBeInTheDocument();
    });
  });

  describe('submitting', () => {
    it('posts exactly the API body', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      renderSheet({ onSubmit });

      await user.click(screen.getByRole('button', { name: /Family intention/ }));
      await user.type(
        screen.getByLabelText(/What are you committing to/),
        'Phone-free dinner',
      );
      await user.click(screen.getByRole('button', { name: '45 min' }));
      await user.click(screen.getByRole('button', { name: 'Add it' }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'FAMILY',
          title: 'Phone-free dinner',
          durationMinutes: 45,
        }),
      );
    });

    it('refuses an empty title with a field error rather than a round trip', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderSheet({ onSubmit });

      await user.click(screen.getByRole('button', { name: /^Commitment/ }));
      await user.click(screen.getByRole('button', { name: 'Add it' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText('Give it a name')).toBeInTheDocument();
    });

    it('rejects a short version longer than the full one, in the field', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderSheet({ onSubmit });

      await user.click(screen.getByRole('button', { name: /^Commitment/ }));
      await user.type(screen.getByLabelText(/What are you committing to/), 'Draft it');
      await user.click(screen.getByRole('button', { name: '10 min' }));
      await user.click(screen.getByRole('button', { name: 'Add smaller versions' }));

      const versions = screen.getByTestId('version-fields');
      await user.type(within(versions).getByLabelText('Short version'), 'Half of it');
      await user.type(within(versions).getAllByLabelText('Minutes')[0], '40');
      await user.click(screen.getByRole('button', { name: 'Add it' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(
        screen.getByText(/short version cannot take longer than the full one/),
      ).toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    const existing = {
      id: 'c1',
      title: 'Draft the proposal storyline',
      domain: 'WORK',
      status: 'PLANNED',
      scheduledStart: '2026-03-02T09:00:00.000Z',
      scheduledEnd: null,
      durationMinutes: 25,
      versions: {
        full: { title: 'Draft the storyline', minutes: 25 },
        short: { title: 'Write the decision statement', minutes: 10 },
        minimum: null,
      },
      importance: 5,
      rescheduleCount: 0,
      startedAt: null,
      completedAt: null,
      versionUsed: null,
      minutesSpent: null,
      outcomeId: outcome.id,
      decomposedFromId: null,
      steps: null,
      timer: null,
      availableActions: ['start'],
    } as CommitmentCard;

    it('skips the chooser and prefills every field', () => {
      renderSheet({ editing: existing });

      expect(screen.queryByTestId('quick-add-kinds')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/What are you committing to/)).toHaveValue(
        'Draft the proposal storyline',
      );
      // The declared short version opens the section rather than hiding it.
      expect(screen.getByDisplayValue('Write the decision statement')).toBeInTheDocument();
    });

    // The API refuses to change it, and a field that silently does nothing is
    // worse than no field.
    it('does not offer to change the domain', () => {
      renderSheet({ editing: existing });

      expect(screen.queryByRole('button', { name: 'Family' })).not.toBeInTheDocument();
    });

    it('says Save rather than Add it', () => {
      renderSheet({ editing: existing });

      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
  });

  describe('eating habits (epic E09)', () => {
    it('offers a nutrition behaviour kind', async () => {
      act(() => setViewportWidth(DESKTOP));
      renderSheet();

      expect(screen.getByRole('button', { name: /Eating habit/ })).toBeEnabled();
    });

    it('shows the registry rather than the commitment form', async () => {
      const user = userEvent.setup();
      act(() => setViewportWidth(DESKTOP));
      renderSheet();

      await user.click(screen.getByRole('button', { name: /Eating habit/ }));

      // PRD §46's whole point: the user PICKS a behaviour rather than writing
      // one, so this kind does not open the editor.
      expect(await screen.findByText('Vegetables with dinner')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Title/)).not.toBeInTheDocument();
    });

    it('closes once a habit has been added', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      act(() => setViewportWidth(DESKTOP));
      renderSheet({ onClose });

      await user.click(screen.getByRole('button', { name: /Eating habit/ }));
      const card = (await screen.findByText('Vegetables with dinner')).closest('.MuiCard-root')!;
      await user.click(
        within(card as HTMLElement).getByRole('button', { name: 'Add to this week' }),
      );

      expect(onClose).toHaveBeenCalled();
    });
  });
});
