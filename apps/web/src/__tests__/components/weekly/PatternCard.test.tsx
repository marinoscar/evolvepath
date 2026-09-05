import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import { render } from '../../utils/test-utils';
import PatternCard from '../../../components/weekly/PatternCard';
import type { ReviewPattern } from '../../../types';

// =============================================================================
// One pattern, three labelled claims (issue #84)
// =============================================================================
//
// PRD §14.4. "You completed 4 of 5 mornings" is an observation; "evenings are
// less reliable for you" is an inference. Labelling them separately is what
// lets a user accept the first and disagree with the second — and a null field
// must render NO row, because a blank "Inference:" reads as one the coach
// declined to share.
// =============================================================================

const full: ReviewPattern = {
  observation: '4 of 5 morning commitments were done',
  inference: 'Plans after 18:00 are less reliable',
  recommendation: 'Move the Wednesday workout to Saturday',
  confidence: 0.8,
  domain: 'HEALTH',
};

describe('PatternCard (#84)', () => {
  it('labels each of the three claims', () => {
    render(<PatternCard pattern={full} />);

    expect(screen.getByText('Observation')).toBeInTheDocument();
    expect(screen.getByText('Inference')).toBeInTheDocument();
    expect(screen.getByText('Recommendation')).toBeInTheDocument();
    expect(screen.getByText(full.observation)).toBeInTheDocument();
  });

  it('renders no row at all for a null claim', () => {
    render(
      <PatternCard pattern={{ ...full, inference: null, recommendation: null }} />,
    );

    expect(screen.getByText('Observation')).toBeInTheDocument();
    expect(screen.queryByText('Inference')).not.toBeInTheDocument();
    expect(screen.queryByText('Recommendation')).not.toBeInTheDocument();
  });

  it.each([
    [0.8, 'High confidence'],
    [0.6, 'Medium confidence'],
    [0.3, 'Low confidence'],
  ])('reports %s as %s', (confidence, label) => {
    render(<PatternCard pattern={{ ...full, confidence }} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('states the confidence as a percentage for a screen reader', () => {
    render(<PatternCard pattern={full} />);

    expect(screen.getByLabelText('confidence 80%')).toBeInTheDocument();
  });

  it('shows the domain when the pattern names one', () => {
    render(<PatternCard pattern={full} />);
    expect(screen.getByText('HEALTH')).toBeInTheDocument();
  });

  it('omits the domain chip when it does not', () => {
    render(<PatternCard pattern={{ ...full, domain: null }} />);
    expect(screen.queryByText('HEALTH')).not.toBeInTheDocument();
  });
});
