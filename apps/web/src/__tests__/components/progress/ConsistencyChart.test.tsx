import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { render } from '../../utils/test-utils';
import ConsistencyChart from '../../../components/progress/ConsistencyChart';
import type { ProgressResponse, WeekStat } from '../../../types';

// =============================================================================
// The consistency run (issue #117, epic E11)
// =============================================================================
//
// The grace has to be VISIBLE. A week the product quietly forgave is a week the
// user cannot reconcile against their own memory, which makes the whole number
// feel invented — and PRD §55 asks for a run people trust.
// =============================================================================

function week(over: Partial<WeekStat> = {}): WeekStat {
  return {
    weekStart: '2026-02-09',
    planned: 4,
    completed: 4,
    success: true,
    graced: false,
    current: false,
    ...over,
  };
}

function run(over: Partial<ProgressResponse['consistencyRun']> = {}) {
  return { weeks: 3, graceUsed: 1, weekly: [week()], ...over };
}

describe('ConsistencyChart (#117)', () => {
  it('counts the run in weeks, never in days', () => {
    render(<ConsistencyChart run={run()} />);

    expect(screen.getByText('3 weeks building momentum')).toBeInTheDocument();
  });

  it('is encouraging rather than empty before the first week lands', () => {
    render(<ConsistencyChart run={run({ weeks: 0, graceUsed: 0 })} />);

    expect(screen.getByText('Your first successful week is ahead')).toBeInTheDocument();
  });

  it('admits the grace out loud', () => {
    render(<ConsistencyChart run={run()} />);

    expect(
      screen.getByText('1 grace week used — a missed week does not erase the ones before it.'),
    ).toBeInTheDocument();
  });

  it('says nothing about grace when none was spent', () => {
    render(<ConsistencyChart run={run({ graceUsed: 0 })} />);

    expect(screen.queryByText(/grace week/)).not.toBeInTheDocument();
  });

  it('offers every week as a table row, with its result in words', () => {
    render(
      <ConsistencyChart
        run={run({
          weekly: [
            week({ weekStart: '2026-02-09' }),
            week({ weekStart: '2026-02-16', completed: 1, success: false, graced: true }),
            week({ weekStart: '2026-02-23', completed: 0, success: false }),
            week({ weekStart: '2026-03-02', current: true }),
          ],
        })}
      />,
    );

    const table = screen.getByRole('table', { name: 'Planned and completed by week' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('Grace week')).toBeInTheDocument();
    expect(within(table).getByText('Missed')).toBeInTheDocument();
    expect(within(table).getByText('In progress')).toBeInTheDocument();
    expect(within(table).getByText('Kept')).toBeInTheDocument();
  });

  it('describes the whole chart in one sentence', () => {
    render(<ConsistencyChart run={run()} />);

    expect(
      screen.getByLabelText('Completed against planned, by week: week of 2026-02-09, 4 of 4'),
    ).toBeInTheDocument();
  });

  it('renders no percentage or score', () => {
    const { container } = render(<ConsistencyChart run={run()} />);

    expect(container.textContent ?? '').not.toMatch(/\d+\s*%|\/\s*100|\bscore\b/i);
  });
});
