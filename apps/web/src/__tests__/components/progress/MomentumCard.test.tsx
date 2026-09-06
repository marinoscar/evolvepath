import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { render } from '../../utils/test-utils';
import MomentumCard from '../../../components/progress/MomentumCard';
import type { Momentum, MomentumState } from '../../../types';

// =============================================================================
// One momentum card (issue #117, epic E11)
// =============================================================================
//
// PRD §122 forbids colour as the only carrier of meaning, and this card carries
// three things that could get it wrong: the state, the two chart series, and
// the numbers behind the chart. Each has a non-colour path, and each is
// asserted here.
// =============================================================================

function momentum(over: Partial<Momentum> = {}): Momentum {
  return {
    domain: 'HEALTH',
    state: 'STEADY',
    evidence: ['5 of 6 planned workouts completed'],
    signals: {
      planned: 6,
      completed: 5,
      partial: 0,
      fallback: 1,
      missed: 1,
      skipped: 0,
      consecutiveMisses: 0,
      rescheduledTwice: 0,
      lastCompletionAt: null,
      lastMissAt: null,
      returnedAfterIdleDays: null,
    },
    trend: [
      { weekStart: '2026-02-09', planned: 2, completed: 2 },
      { weekStart: '2026-02-16', planned: 2, completed: 1 },
      { weekStart: '2026-02-23', planned: 1, completed: 1 },
      { weekStart: '2026-03-02', planned: 1, completed: 1 },
    ],
    ...over,
  };
}

describe('MomentumCard (#117)', () => {
  it.each<[MomentumState, string]>([
    ['BUILDING', 'Building'],
    ['IMPROVING', 'Improving'],
    ['STEADY', 'Steady'],
    ['SLIPPING', 'Slipping'],
    ['RECOVERING', 'Recovering'],
    ['INSUFFICIENT_DATA', 'Not enough yet'],
  ])('says %s in words, not only in colour', (state, label) => {
    render(<MomentumCard momentum={momentum({ state })} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByLabelText(`Health momentum: ${label}`),
    ).toBeInTheDocument();
  });

  it('distinguishes the two series by line style as well as colour', () => {
    render(<MomentumCard momentum={momentum()} />);

    // The legend text carries the encoding, so it survives greyscale, a
    // printout and forced-colors mode.
    expect(screen.getByText('Planned (dashed)')).toBeInTheDocument();
    expect(screen.getByText('Completed (solid)')).toBeInTheDocument();
  });

  it('describes the trend in a sentence for a reader the chart cannot reach', () => {
    render(<MomentumCard momentum={momentum()} />);

    expect(
      screen.getByLabelText('Health completions per week, last four weeks: 2, 1, 1, 1'),
    ).toBeInTheDocument();
  });

  it('offers the same numbers as a table', () => {
    render(<MomentumCard momentum={momentum()} />);

    const table = screen.getByRole('table', {
      name: 'Health planned and completed by week',
    });
    // Four weeks plus the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(5);
  });

  it('shows the evidence bullets under a "Why" caption', () => {
    render(
      <MomentumCard
        momentum={momentum({
          evidence: ['5 of 6 planned workouts completed', '1 completed with the short or minimum version'],
        })}
      />,
    );

    expect(screen.getByText('Why')).toBeInTheDocument();
    // Scoped: the chart legend is a list too.
    expect(
      within(screen.getByTestId('momentum-evidence')).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('renders no percentage and no score, in any state', () => {
    for (const state of [
      'BUILDING',
      'IMPROVING',
      'STEADY',
      'SLIPPING',
      'RECOVERING',
      'INSUFFICIENT_DATA',
    ] as MomentumState[]) {
      const { container, unmount } = render(
        <MomentumCard momentum={momentum({ state })} />,
      );

      expect(container.textContent ?? '').not.toMatch(/\d+\s*%|\/\s*100|\bscore\b/i);
      unmount();
    }
  });
});
