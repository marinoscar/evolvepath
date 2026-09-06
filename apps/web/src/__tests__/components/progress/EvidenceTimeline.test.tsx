import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import EvidenceTimeline, {
  COMPACT_TIMELINE_ROWS,
} from '../../../components/progress/EvidenceTimeline';
import type { TimelineEvent } from '../../../types';

// =============================================================================
// The evidence timeline (issue #117, epic E11)
// =============================================================================
//
// PRD §77's "celebrations must match significance" is a rendering rule here:
// three weights, and none of them is colour alone.
// =============================================================================

function event(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'e1',
    at: '2026-03-05T07:00:00.000Z',
    kind: 'completed',
    significance: 'ordinary',
    domain: 'HEALTH',
    title: 'Completed Upper A',
    detail: null,
    commitmentId: 'c1',
    milestoneId: null,
    ...over,
  };
}

describe('EvidenceTimeline (#117)', () => {
  it('says so plainly when there is nothing yet', () => {
    render(<EvidenceTimeline items={[]} />);

    expect(
      screen.getByText('What you do will appear here, newest first.'),
    ).toBeInTheDocument();
  });

  it('groups rows by day', () => {
    render(
      <EvidenceTimeline
        items={[
          event({ id: 'a', at: '2026-03-05T07:00:00.000Z' }),
          event({ id: 'b', at: '2026-03-05T19:00:00.000Z' }),
          event({ id: 'c', at: '2026-03-02T07:00:00.000Z' }),
        ]}
      />,
    );

    // Two days, so two day headings.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });

  it('renders the three weights distinguishably', () => {
    render(
      <EvidenceTimeline
        items={[
          event({ id: 'm', significance: 'milestone', kind: 'milestone', title: 'First comeback' }),
          event({ id: 'n', significance: 'notable', kind: 'family_kept', title: 'Protected family dinner' }),
          event({ id: 'o', significance: 'ordinary' }),
        ]}
      />,
    );

    const milestone = screen.getByTestId('timeline-milestone');
    // The chip is the non-colour carrier: a reader who cannot see the border
    // or the icon still reads the word.
    expect(within(milestone).getByText('Milestone')).toBeInTheDocument();

    expect(screen.getByTestId('timeline-notable')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-ordinary')).toBeInTheDocument();
  });

  it('shows a detail line when the event has one', () => {
    render(
      <EvidenceTimeline
        items={[
          event({
            kind: 'plan_change_accepted',
            significance: 'notable',
            title: 'Plan updated to v3',
            detail: 'Mornings stopped working',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Mornings stopped working')).toBeInTheDocument();
  });

  describe('compact mode', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      event({ id: `e${i}`, at: `2026-03-05T0${i % 10}:00:00.000Z` }),
    );

    it('shows a bounded strip and a way to the whole list', () => {
      render(<EvidenceTimeline items={many} compact />);

      expect(screen.getAllByRole('listitem')).toHaveLength(COMPACT_TIMELINE_ROWS);
      expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute(
        'href',
        '/progress/timeline',
      );
    });

    it('offers no Load more — the strip is a preview, not a pager', () => {
      render(<EvidenceTimeline items={many} compact hasMore onLoadMore={vi.fn()} />);

      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });
  });

  describe('full mode', () => {
    it('pages when there is more', async () => {
      const user = userEvent.setup();
      const onLoadMore = vi.fn();

      render(<EvidenceTimeline items={[event()]} hasMore onLoadMore={onLoadMore} />);

      await user.click(screen.getByRole('button', { name: 'Load more' }));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('hides the pager when the history is exhausted', () => {
      render(<EvidenceTimeline items={[event()]} onLoadMore={vi.fn()} />);

      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });
  });
});
