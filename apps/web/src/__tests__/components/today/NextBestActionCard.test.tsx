import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { NextBestActionCard } from '../../../components/today/NextBestActionCard';
import type { NextBestAction } from '../../../types';

const nba = (over: Partial<NextBestAction> = {}): NextBestAction => ({
  commitmentId: 'c1',
  title: 'Draft the storyline',
  domain: 'WORK',
  durationMinutes: 25,
  version: 'full',
  rationale: 'This is the most useful 25 minutes you have right now.',
  fallback: { title: 'Write the decision statement', durationMinutes: 10 },
  interventionMode: 'ACT',
  confidence: 0.8,
  ...over,
});

describe('NextBestActionCard', () => {
  it('shows the title, the size, the domain and the rationale', () => {
    render(
      <NextBestActionCard
        nba={nba()}
        onStart={vi.fn()}
        onMakeSmaller={vi.fn()}
        onAddSomething={vi.fn()}
      />,
    );

    const card = screen.getByTestId('next-best-action');
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Draft the storyline',
    );
    expect(within(card).getByText('25 min')).toBeInTheDocument();
    expect(within(card).getByText('Work')).toBeInTheDocument();
    // The rationale is what makes this a recommendation rather than a to-do row.
    expect(screen.getByTestId('nba-rationale')).toHaveTextContent(
      'This is the most useful 25 minutes you have right now.',
    );
  });

  it('names the smaller thing beside the recommendation', () => {
    render(
      <NextBestActionCard
        nba={nba()}
        onStart={vi.fn()}
        onMakeSmaller={vi.fn()}
        onAddSomething={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Or just: Write the decision statement · 10 min/),
    ).toBeInTheDocument();
  });

  it('marks a recommendation that is not the full version', () => {
    render(
      <NextBestActionCard
        nba={nba({ version: 'minimum', durationMinutes: 5 })}
        onStart={vi.fn()}
        onMakeSmaller={vi.fn()}
        onAddSomething={vi.fn()}
      />,
    );

    expect(screen.getByText('Minimum version')).toBeInTheDocument();
  });

  // Someone coming back after a gap is not starting what a consistent week
  // starts; naming it makes the screen sound like it noticed.
  it('says Restart in RECOVER mode', () => {
    render(
      <NextBestActionCard
        nba={nba({ interventionMode: 'RECOVER', durationMinutes: 10 })}
        onStart={vi.fn()}
        onMakeSmaller={vi.fn()}
        onAddSomething={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Restart · 10 min' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
  });

  it('calls the handlers with the recommendation', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onMakeSmaller = vi.fn();
    const value = nba();

    render(
      <NextBestActionCard
        nba={value}
        onStart={onStart}
        onMakeSmaller={onMakeSmaller}
        onAddSomething={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start 25 min' }));
    expect(onStart).toHaveBeenCalledWith(value);

    await user.click(screen.getByRole('button', { name: 'Make it smaller' }));
    expect(onMakeSmaller).toHaveBeenCalledWith(value);
  });

  it('disables both buttons while an action is in flight', () => {
    render(
      <NextBestActionCard
        nba={nba()}
        disabled
        onStart={vi.fn()}
        onMakeSmaller={vi.fn()}
        onAddSomething={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Start 25 min' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make it smaller' })).toBeDisabled();
  });

  describe('when there is nothing to recommend', () => {
    it('offers a way forward rather than a shrug', async () => {
      const user = userEvent.setup();
      const onAddSomething = vi.fn();

      render(
        <NextBestActionCard
          nba={null}
          onStart={vi.fn()}
          onMakeSmaller={vi.fn()}
          onAddSomething={onAddSomething}
        />,
      );

      expect(screen.getByTestId('nba-empty')).toBeInTheDocument();
      expect(screen.getByText(/An empty day is fine/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Add something small' }));
      expect(onAddSomething).toHaveBeenCalled();
    });
  });
});
