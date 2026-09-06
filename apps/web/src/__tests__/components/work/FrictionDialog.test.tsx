import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../../utils/test-utils';
import { FrictionDialog } from '../../../components/work/FrictionDialog';
import { FRICTION_ANSWERS } from '../../../components/work/frictionAnswers';
import { setInterventionSource } from '../../mocks/workHandlers';
import type { CommitmentCard, FrictionAnswer } from '../../../types';

// =============================================================================
// "What's making it hard to start?" (issue #118, epic E07)
// =============================================================================

const commitment: Pick<CommitmentCard, 'id' | 'title' | 'rescheduleCount' | 'versions'> = {
  id: 'commitment-1',
  title: 'Finish the strategy presentation',
  rescheduleCount: 2,
  versions: {
    full: { title: 'Finish the deck', minutes: 45 },
    short: null,
    minimum: { title: 'Open the deck and write one line', minutes: 5 },
  },
};

function renderDialog(overrides: Partial<Parameters<typeof FrictionDialog>[0]> = {}) {
  const props = {
    open: true,
    commitment,
    onClose: vi.fn(),
    onResolved: vi.fn(),
    onStart: vi.fn(),
    onUseMinimum: vi.fn(),
    onProtectedReschedule: vi.fn(),
    ...overrides,
  };

  return { ...render(<FrictionDialog {...props} />), props };
}

describe('FrictionDialog', () => {
  it('lists the eight answers in VISION §9 order', () => {
    renderDialog();

    for (const option of FRICTION_ANSWERS) {
      expect(screen.getByTestId(`friction-answer-${option.key}`)).toBeInTheDocument();
      expect(screen.getByLabelText(option.label)).toBeInTheDocument();
    }

    const labels = screen
      .getAllByRole('radio')
      .map((radio) => (radio as HTMLInputElement).value);

    expect(labels).toEqual(FRICTION_ANSWERS.map((option) => option.key));
  });

  it('names how many times it has moved', () => {
    renderDialog();

    expect(screen.getByText(/you've moved .* 2 times/i)).toBeInTheDocument();
  });

  it('cannot be sent until an answer is chosen', async () => {
    renderDialog();

    expect(screen.getByTestId('friction-send')).toBeDisabled();

    await userEvent.click(screen.getByTestId('friction-answer-TIRED'));

    expect(screen.getByTestId('friction-send')).toBeEnabled();
  });

  it('requires text for OTHER — an unexplained "other" routes nowhere', async () => {
    renderDialog();

    await userEvent.click(screen.getByTestId('friction-answer-OTHER'));
    expect(screen.getByTestId('friction-send')).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/tell the coach more/i), 'A meeting ran over');
    expect(screen.getByTestId('friction-send')).toBeEnabled();
  });

  it('answers "it feels too big" with a decomposition and a ten-minute start', async () => {
    const { props } = renderDialog();

    await userEvent.click(screen.getByTestId('friction-answer-TOO_BIG'));
    await userEvent.click(screen.getByTestId('friction-send'));

    expect(await screen.findByTestId('intervention-card')).toHaveTextContent(
      /stop treating this like one task/i,
    );

    await userEvent.click(screen.getByTestId('intervention-start'));

    expect(props.onStart).toHaveBeenCalledWith(10, 'Write the first three bullets');
  });

  it('offers the minimum version alongside the recommendation', async () => {
    const { props } = renderDialog();

    await userEvent.click(screen.getByTestId('friction-answer-TIRED'));
    await userEvent.click(screen.getByTestId('friction-send'));

    await userEvent.click(await screen.findByTestId('intervention-minimum'));

    expect(props.onUseMinimum).toHaveBeenCalled();
  });

  it('offers a protected move for "something more urgent came up", and no start', async () => {
    const { props } = renderDialog();

    await userEvent.click(screen.getByTestId('friction-answer-SOMETHING_URGENT'));
    await userEvent.click(screen.getByTestId('friction-send'));

    const move = await screen.findByTestId('intervention-protected-reschedule');
    expect(screen.queryByTestId('intervention-start')).not.toBeInTheDocument();

    await userEvent.click(move);

    expect(props.onProtectedReschedule).toHaveBeenCalledWith({
      scheduledStart: '2026-09-09T09:00:00.000Z',
      scheduledEnd: '2026-09-09T09:25:00.000Z',
    });
  });

  it('says out loud when the suggestion came from the template', async () => {
    setInterventionSource('template');
    renderDialog();

    await userEvent.click(screen.getByTestId('friction-answer-WORRIED_ABOUT_QUALITY'));
    await userEvent.click(screen.getByTestId('friction-send'));

    expect(await screen.findByText(/standard suggestion/i)).toBeInTheDocument();
  });

  it('says nothing about a source when the coach answered', async () => {
    renderDialog();

    await userEvent.click(screen.getByTestId('friction-answer-TOO_BIG'));
    await userEvent.click(screen.getByTestId('friction-send'));

    await screen.findByTestId('intervention-card');
    expect(screen.queryByText(/standard suggestion/i)).not.toBeInTheDocument();
  });

  it.each(FRICTION_ANSWERS.map((option) => option.key))(
    'sends %s and shows an intervention for it',
    async (answer: FrictionAnswer) => {
      renderDialog();

      await userEvent.click(screen.getByTestId(`friction-answer-${answer}`));

      if (answer === 'OTHER') {
        await userEvent.type(screen.getByLabelText(/tell the coach more/i), 'Something else');
      }

      await userEvent.click(screen.getByTestId('friction-send'));

      expect(await screen.findByTestId('intervention-card')).toBeInTheDocument();
    },
  );

  it('has no axe violations', async () => {
    // jsdom performs no layout, so `color-contrast` is a known false negative —
    // the same exclusion every other conformance suite here documents.
    const { baseElement } = renderDialog();

    expect(
      await axe(baseElement, { rules: { 'color-contrast': { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
