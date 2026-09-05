import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import { render } from '../../utils/test-utils';
import { makeAggregates } from '../../mocks/weeklyHandlers';
import WeekDomainTiles from '../../../components/weekly/WeekDomainTiles';

// =============================================================================
// Planned versus done (issue #84)
// =============================================================================
//
// The assertion that matters most here is a NEGATIVE one: no colour is applied
// to the number. VISION §30 — this product does not signal worth, and a "2 / 3"
// in red is a verdict on somebody's week dressed as data visualisation.
// =============================================================================

describe('WeekDomainTiles (#84)', () => {
  it('renders completed over planned for each domain', () => {
    render(<WeekDomainTiles aggregates={makeAggregates()} />);

    expect(screen.getByTestId('week-tile-WORK')).toHaveTextContent('4 / 5');
    expect(screen.getByTestId('week-tile-FAMILY')).toHaveTextContent('2 / 3');
    expect(screen.getByTestId('week-tile-HEALTH')).toHaveTextContent('2 / 3');
  });

  it('spells the numbers out for a screen reader', () => {
    render(<WeekDomainTiles aggregates={makeAggregates()} />);

    expect(
      screen.getByLabelText('Work: 4 of 5 commitments done'),
    ).toBeInTheDocument();
  });

  it('never colours the number', () => {
    render(<WeekDomainTiles aggregates={makeAggregates()} />);

    for (const domain of ['WORK', 'FAMILY', 'HEALTH']) {
      const number = screen.getByTestId(`week-tile-${domain}`).querySelector('p');
      const colour = number ? getComputedStyle(number).color : '';

      expect(colour).not.toMatch(/rgb\(2[0-9]{2},\s*[0-6][0-9],/); // no red
    }
  });

  it('shows the secondary line only when there is something in it', () => {
    render(<WeekDomainTiles aggregates={makeAggregates()} />);

    // HEALTH has one fallback and one moved row; WORK has a skip.
    expect(screen.getByTestId('week-tile-HEALTH')).toHaveTextContent('1 moved');
    expect(screen.getByTestId('week-tile-WORK')).toHaveTextContent('1 skipped');
    // FAMILY has one skip and nothing else — no "0 partial".
    expect(screen.getByTestId('week-tile-FAMILY')).not.toHaveTextContent('partial');
  });

  it('says the week is in progress rather than treating it as thin', () => {
    const partial = makeAggregates();
    partial.coverage.partial = true;

    render(<WeekDomainTiles aggregates={partial} />);

    expect(screen.getByText(/week in progress/i)).toBeInTheDocument();
  });

  it('says nothing about coverage once the week is over', () => {
    render(<WeekDomainTiles aggregates={makeAggregates()} />);

    expect(screen.queryByText(/week in progress/i)).not.toBeInTheDocument();
  });
});
