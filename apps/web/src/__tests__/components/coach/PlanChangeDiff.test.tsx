import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';

import { render } from '../../utils/test-utils';
import PlanChangeDiff, { formatValue } from '../../../components/coach/PlanChangeDiff';
import type { DiffEntry } from '../../../types';

// =============================================================================
// The diff (issue #86)
// =============================================================================
//
// Exported for E10's Weekly Review, so this file is the contract two screens
// share: whatever the source of a `DiffEntry[]`, "Wednesday 18:30 → Saturday
// 09:00" reads the same way.
// =============================================================================

const move: DiffEntry = {
  op: 'move',
  target: { type: 'routine', id: 'r1', title: 'Strength workout' },
  reason: 'Wednesday evenings stopped working',
  fields: [
    { field: 'triggerValue', before: 'WED', after: 'SAT' },
    { field: 'preferredTime', before: '18:30', after: '09:00' },
  ],
};

const reduce: DiffEntry = {
  op: 'reduce',
  target: { type: 'routine', id: 'r2', title: 'Evening walk' },
  reason: 'Shorter sessions get done',
  fields: [{ field: 'estimatedDurationMin', before: 40, after: 15 }],
};

const remove: DiffEntry = {
  op: 'remove',
  target: { type: 'routine', id: 'r3', title: 'Saturday run' },
  reason: 'Not doing this any more',
  fields: [],
};

const add: DiffEntry = {
  op: 'add',
  target: { type: 'routine', id: 'new', title: 'Saturday walk' },
  reason: 'Something easy to keep the week alive',
  fields: [{ field: 'title', before: null, after: 'Saturday walk' }],
};

describe('PlanChangeDiff (#86)', () => {
  it('renders a captioned table with column headers at wide widths', () => {
    render(<PlanChangeDiff entries={[move]} />);

    const table = screen.getByTestId('plan-change-diff-table');
    expect(within(table).getByText('Proposed changes')).toBeInTheDocument();

    for (const header of ['Change', 'Before', 'After', 'Why']) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }

    expect(within(table).getByText('18:30')).toBeInTheDocument();
    expect(within(table).getByText('09:00')).toBeInTheDocument();
  });

  it('renders stacked cards when dense', () => {
    render(<PlanChangeDiff entries={[move]} dense />);

    // A four-column table is the clearest before/after on a wide screen and
    // the worst on a 375 px one.
    expect(screen.getByTestId('plan-change-diff-cards')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-change-diff-table')).not.toBeInTheDocument();
    expect(screen.getByText(/Move · Strength workout/)).toBeInTheDocument();
  });

  it.each([
    ['reduce', reduce, '15 min'],
    ['add', add, 'Saturday walk'],
  ])('renders a %s entry', (_label, entry, expected) => {
    render(<PlanChangeDiff entries={[entry]} />);

    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
  });

  it('renders an entry with no field changes as one row', () => {
    render(<PlanChangeDiff entries={[remove]} />);

    expect(screen.getByText('Remove · Saturday run')).toBeInTheDocument();
    expect(screen.getByText('Not doing this any more')).toBeInTheDocument();
  });

  it('says so when there is nothing to show', () => {
    render(<PlanChangeDiff entries={[]} />);

    expect(screen.getByText('No changes to show.')).toBeInTheDocument();
  });

  describe('formatValue', () => {
    it('reads null as an em dash, never as the word "null"', () => {
      expect(formatValue('preferredTime', null)).toBe('—');
      expect(formatValue('preferredTime', undefined)).toBe('—');
      expect(formatValue('preferredTime', '')).toBe('—');
    });

    it('names weekdays rather than printing their indices', () => {
      expect(formatValue('daysOfWeek', [3])).toBe('Wed');
      expect(formatValue('daysOfWeek', [1, 3, 5])).toBe('Mon, Wed, Fri');
    });

    it('gives durations their unit and booleans a word', () => {
      expect(formatValue('estimatedDurationMin', 40)).toBe('40 min');
      expect(formatValue('active', false)).toBe('No');
    });
  });
});
