import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WeightTrendChart } from '../../../components/health/WeightTrendChart';
import type { WeightTrend } from '../../../types';

// =============================================================================
// PRD §47's prohibitions, asserted (issue #113, epic E09)
//
// The rules here are mostly about what the chart must NOT do, and every one of
// them is the kind of thing that creeps back in as "a small improvement":
// a red day, an arrow, a "great week". So they are tests.
// =============================================================================

function trendOf(
  items: Array<[string, number]>,
  rolling: Array<[string, number | null]>,
  summary: WeightTrend['summary'] = null,
): WeightTrend {
  return {
    items: items.map(([dateLocal, weightKg]) => ({ dateLocal, weightKg })),
    trend: rolling.map(([dateLocal, rolling7Kg]) => ({ dateLocal, rolling7Kg })),
    summary,
  };
}

describe('WeightTrendChart', () => {
  it('draws one muted point per reading and one line for the trend', () => {
    render(
      <WeightTrendChart
        trend={trendOf(
          [
            ['2026-09-01', 83],
            ['2026-09-02', 82.6],
            ['2026-09-03', 82.4],
          ],
          [
            ['2026-09-01', null],
            ['2026-09-02', 82.8],
            ['2026-09-03', 82.7],
          ],
          { first: 82.8, last: 82.7, deltaKg: -0.1, days: 3 },
        )}
      />,
    );

    expect(screen.getAllByTestId('weight-point')).toHaveLength(3);
    expect(screen.getAllByTestId('weight-trend-line')).toHaveLength(1);
  });

  it('states the trend in words, so meaning never rides on colour alone', () => {
    render(
      <WeightTrendChart
        trend={trendOf(
          [['2026-09-01', 83]],
          [['2026-09-01', 82.8]],
          { first: 83.1, last: 82.8, deltaKg: -0.3, days: 21 },
        )}
      />,
    );

    expect(screen.getByText(/7-day trend: −0\.3 kg over 21 logged days/)).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/−0\.3 kg/);
  });

  it('breaks the line where there is no trend rather than drawing across the gap', () => {
    render(
      <WeightTrendChart
        trend={trendOf(
          [
            ['2026-09-01', 83],
            ['2026-09-10', 82],
          ],
          [
            ['2026-09-01', 83],
            ['2026-09-02', 83],
            ['2026-09-03', null],
            ['2026-09-04', null],
            ['2026-09-09', 82],
            ['2026-09-10', 82],
          ],
        )}
      />,
    );

    // Two runs, not one segment ploughing through the silence between them.
    expect(screen.getAllByTestId('weight-trend-line')).toHaveLength(2);
  });

  it('asks for more days rather than drawing a direction through one reading', () => {
    render(
      <WeightTrendChart trend={trendOf([['2026-09-01', 83]], [['2026-09-01', null]])} />,
    );

    expect(screen.getByText('Log a few more days to see a trend')).toBeInTheDocument();
    expect(screen.queryByTestId('weight-trend-line')).not.toBeInTheDocument();
  });

  it('renders the caption alone when there is nothing at all', () => {
    render(<WeightTrendChart trend={trendOf([], [])} />);

    expect(screen.getByText('Log a few more days to see a trend')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes the readings as a table for anyone who cannot see the picture', () => {
    render(
      <WeightTrendChart
        trend={trendOf(
          [
            ['2026-09-01', 83],
            ['2026-09-02', 82.6],
          ],
          [
            ['2026-09-01', null],
            ['2026-09-02', 82.8],
          ],
        )}
      />,
    );

    expect(screen.getByRole('table', { name: 'Weight readings' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '2026-09-01' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '82.6' })).toBeInTheDocument();
  });

  it('never judges a day', () => {
    const { container } = render(
      <WeightTrendChart
        trend={trendOf(
          [['2026-09-01', 83]],
          [['2026-09-01', 83]],
          { first: 84, last: 83, deltaKg: -1, days: 7 },
        )}
      />,
    );

    // PRD §47. The copy is the part most likely to drift back towards
    // encouragement that is really evaluation.
    expect(container.textContent ?? '').not.toMatch(/bad|good|great|oops|guilt|well done/i);
  });
});
