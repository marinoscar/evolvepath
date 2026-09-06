import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../../utils/test-utils';
import {
  MediaAdviceCard,
  SEEK_PROFESSIONAL_COPY,
} from '../../../components/media/MediaAdviceCard';

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

const ADVICE = {
  summary: 'Your setup looks steady through the whole rep.',
  observations: ['Your feet stay under the bar.', 'The bar path is vertical.'],
  advice: ['Brace hard before you unrack.'],
  safetyFlag: { level: 'none' as const, reason: '' },
};

describe('MediaAdviceCard', () => {
  it('renders the summary, the observations and the advice', async () => {
    const { container } = render(
      <MediaAdviceCard
        advice={ADVICE}
        kind="VIDEO"
        askedAt={new Date().toISOString()}
      />,
    );

    expect(screen.getByTestId('media-advice-summary')).toHaveTextContent(
      'Your setup looks steady',
    );
    expect(screen.getByText('What I noticed')).toBeInTheDocument();
    expect(screen.getByText('Try this')).toBeInTheDocument();
    expect(screen.getByText('Your feet stay under the bar.')).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('renders nothing extra when the safety level is none', () => {
    render(
      <MediaAdviceCard
        advice={ADVICE}
        kind="PHOTO"
        askedAt={new Date().toISOString()}
      />,
    );

    expect(screen.queryByTestId('media-advice-safety')).toBeNull();
  });

  it('renders a warning for caution, with the model’s reason', () => {
    render(
      <MediaAdviceCard
        advice={{
          ...ADVICE,
          safetyFlag: {
            level: 'caution',
            reason: 'Your knees track inward under load.',
          },
        }}
        kind="VIDEO"
        askedAt={new Date().toISOString()}
      />,
    );

    const alert = screen.getByTestId('media-advice-safety');
    expect(alert).toHaveTextContent('Your knees track inward under load.');
  });

  it('renders the FIXED professional-care copy, not the model’s words', async () => {
    // PRD §45, §81: the sentence a person reads when told to see a
    // professional has to be the same sentence every time — including on the
    // day the provider is having a bad one. The model's reason appears beside
    // it, never instead of it.
    const { container } = render(
      <MediaAdviceCard
        advice={{
          ...ADVICE,
          safetyFlag: {
            level: 'seek_professional',
            reason: 'You reported sharp pain in the second rep.',
          },
        }}
        kind="VIDEO"
        askedAt={new Date().toISOString()}
      />,
    );

    const alert = screen.getByTestId('media-advice-safety');
    expect(alert).toHaveTextContent('Please get this checked');
    expect(alert).toHaveTextContent(SEEK_PROFESSIONAL_COPY);
    expect(alert).toHaveTextContent('see a qualified professional');
    // The reason is shown too — it is what makes the warning specific.
    expect(alert).toHaveTextContent('sharp pain in the second rep');
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('names the medium in the footer', () => {
    render(
      <MediaAdviceCard
        advice={ADVICE}
        kind="PHOTO"
        askedAt={new Date().toISOString()}
      />,
    );

    expect(screen.getByText(/read of this photo/)).toBeInTheDocument();
  });

  it('renders an advice-only answer with no observations', () => {
    render(
      <MediaAdviceCard
        advice={{ ...ADVICE, observations: [] }}
        kind="PHOTO"
        askedAt={new Date().toISOString()}
      />,
    );

    expect(screen.queryByText('What I noticed')).toBeNull();
    expect(screen.getByText('Try this')).toBeInTheDocument();
  });
});
