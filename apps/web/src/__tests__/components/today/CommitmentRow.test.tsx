import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { CommitmentRow } from '../../../components/today/CommitmentRow';
import type { CommitmentCard } from '../../../types';

const card = (over: Partial<CommitmentCard> = {}): CommitmentCard => ({
  id: 'c1',
  title: 'Draft the proposal storyline',
  domain: 'WORK',
  status: 'PLANNED',
  scheduledStart: '2026-03-02T09:00:00.000Z',
  scheduledEnd: null,
  durationMinutes: 25,
  versions: {
    full: { title: 'Draft the storyline', minutes: 25 },
    short: null,
    minimum: null,
  },
  importance: 5,
  rescheduleCount: 0,
  startedAt: null,
  completedAt: null,
  versionUsed: null,
  minutesSpent: null,
  outcomeId: null,
  decomposedFromId: null,
  steps: null,
  timer: null,
  availableActions: ['start', 'complete', 'skip'],
  ...over,
});

describe('CommitmentRow', () => {
  // A menu the client computed would eventually offer a move the API refuses,
  // and the user would be the one to find out.
  it('renders exactly the API’s availableActions, and nothing else', async () => {
    const user = userEvent.setup();
    render(<CommitmentRow commitment={card()} onAction={vi.fn()} />);

    // The first action is the row's primary button.
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Actions for Draft the proposal storyline' }),
    );
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Complete',
      'Skip',
    ]);
  });

  it('offers no menu at all when the API listed one action', () => {
    render(<CommitmentRow commitment={card({ availableActions: ['start'] })} onAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Actions for/ }),
    ).not.toBeInTheDocument();
  });

  it('offers nothing on a terminal commitment', () => {
    render(
      <CommitmentRow
        commitment={card({ status: 'COMPLETED', availableActions: [] })}
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Draft the proposal storyline')).toBeInTheDocument();
  });

  it('reports the action and the commitment to its caller', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const commitment = card();

    render(<CommitmentRow commitment={commitment} onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(onAction).toHaveBeenCalledWith('start', commitment);
  });

  it('shows how often the commitment has been moved', () => {
    render(<CommitmentRow commitment={card({ rescheduleCount: 2 })} onAction={vi.fn()} />);

    expect(screen.getByLabelText('Moved 2 times')).toBeInTheDocument();
  });

  it('shows no badge for a commitment that has never moved', () => {
    render(<CommitmentRow commitment={card()} onAction={vi.fn()} />);

    expect(screen.queryByLabelText(/Moved/)).not.toBeInTheDocument();
  });

  // PRD §101 wants "done, but smaller" visible as its own fact.
  it('marks a commitment that was done with a fallback version', () => {
    render(
      <CommitmentRow
        commitment={card({ versionUsed: 'MINIMUM', status: 'COMPLETED', availableActions: [] })}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText('Minimum version')).toBeInTheDocument();
  });

  it('says nothing extra when the full version was done', () => {
    render(
      <CommitmentRow
        commitment={card({ versionUsed: 'FULL', status: 'COMPLETED', availableActions: [] })}
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByText(/version/i)).not.toBeInTheDocument();
  });

  it('disables its buttons while its own action is in flight', () => {
    render(<CommitmentRow commitment={card()} disabled onAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});
