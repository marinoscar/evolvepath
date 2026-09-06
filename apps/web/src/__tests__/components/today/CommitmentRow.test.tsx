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
  avoidance: null,
  availableActions: ['start', 'complete', 'skip'],
  ...over,
});

/** An assessment shaped like the API's, with the action under test on it. */
const ladder = (suggestedAction: CommitmentCard['avoidance'] extends null ? never : string) => ({
  level: 3,
  interventionType: 'FRICTION_DIAGNOSIS',
  signals: ['RESCHEDULED_TWICE'],
  rationale: 'This has been moved 2 times.',
  suggestedAction: suggestedAction as never,
});

describe('CommitmentRow', () => {
  // A menu the client computed would eventually offer a move the API refuses,
  // and the user would be the one to find out. `Edit` is the one deliberate
  // addition: it is a PATCH rather than an action endpoint, appended by the row
  // only where the API would accept the patch.
  it('renders the API’s availableActions, plus Edit where a PATCH is allowed', async () => {
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
      'Edit',
    ]);
  });

  it('offers no menu at all when there is nothing left to put in one', () => {
    render(
      <CommitmentRow
        commitment={card({ status: 'STARTED', availableActions: ['pause'] })}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Actions for/ }),
    ).not.toBeInTheDocument();
  });

  // The API refuses a PATCH on a started or terminal commitment.
  it('offers Edit only while the commitment is still PLANNED or READY', async () => {
    const user = userEvent.setup();

    render(
      <CommitmentRow
        commitment={card({ status: 'READY', availableActions: ['start', 'complete'] })}
        onAction={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Actions for Draft the proposal storyline' }),
    );
    expect(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Edit' }),
    ).toBeInTheDocument();
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

  describe('a workout commitment (epic E09)', () => {
    it('offers the runner instead of the generic timer', () => {
      render(
        <CommitmentRow
          commitment={card({ status: 'PLANNED', workoutTemplateId: 'template-1' })}
          onAction={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Start workout' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    });

    it('leaves a Health commitment without a workout on the generic timer', () => {
      // A walk is a Health commitment too; the domain is not the signal.
      render(
        <CommitmentRow
          commitment={card({ status: 'PLANNED', domain: 'HEALTH' })}
          onAction={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    });

    it('reports the workout action to the page', async () => {
      const onAction = vi.fn();
      const user = userEvent.setup();
      const commitment = card({ status: 'PLANNED', workoutTemplateId: 'template-1' });
      render(<CommitmentRow commitment={commitment} onAction={onAction} />);

      await user.click(screen.getByRole('button', { name: 'Start workout' }));

      expect(onAction).toHaveBeenCalledWith('start_workout', commitment);
    });
  });
});

// =============================================================================
// The intervention ladder's affordances (issue #118, epic E07)
// =============================================================================
//
// The row branches on `suggestedAction` and NEVER on the level. The level is
// the server's reasoning; a row that read it would be a second copy of the rule
// that produced it.
// =============================================================================

describe('CommitmentRow — the intervention ladder (#118)', () => {
  it('asks the VISION §9 question at FRICTION_QUESTION', async () => {
    const onAskFriction = vi.fn();
    const commitment = card({ rescheduleCount: 2, avoidance: ladder('FRICTION_QUESTION') });

    render(
      <CommitmentRow
        commitment={commitment}
        onAction={vi.fn()}
        onAskFriction={onAskFriction}
      />,
    );

    expect(screen.getByTestId('friction-prompt-c1')).toHaveTextContent(
      /what's making it hard to start/i,
    );

    await userEvent.click(screen.getByTestId('friction-answer-open-c1'));

    expect(onAskFriction).toHaveBeenCalledWith(commitment);
  });

  it('offers the minimum version at MINIMUM', async () => {
    const onAction = vi.fn();

    render(
      <CommitmentRow
        commitment={card({
          avoidance: ladder('MINIMUM'),
          versions: {
            full: { title: 'Draft the storyline', minutes: 25 },
            short: null,
            minimum: { title: 'Open the doc', minutes: 5 },
          },
        })}
        onAction={onAction}
      />,
    );

    await userEvent.click(screen.getByTestId('do-the-minimum-c1'));

    expect(onAction).toHaveBeenCalledWith('fallback', expect.objectContaining({ id: 'c1' }));
  });

  it('offers to break it down at DECOMPOSE', async () => {
    const onAction = vi.fn();

    render(
      <CommitmentRow commitment={card({ avoidance: ladder('DECOMPOSE') })} onAction={onAction} />,
    );

    await userEvent.click(screen.getByTestId('break-it-down-c1'));

    expect(onAction).toHaveBeenCalledWith('decompose', expect.objectContaining({ id: 'c1' }));
  });

  it('names the environment at ENVIRONMENT', () => {
    render(
      <CommitmentRow commitment={card({ avoidance: ladder('ENVIRONMENT') })} onAction={vi.fn()} />,
    );

    expect(screen.getByText(/put email and slack aside/i)).toBeInTheDocument();
  });

  it('points at the coach at PLAN_REVIEW', () => {
    render(
      <CommitmentRow commitment={card({ avoidance: ladder('PLAN_REVIEW') })} onAction={vi.fn()} />,
    );

    expect(screen.getByTestId('review-with-coach-c1')).toHaveAttribute('href', '/coach');
  });

  it('renders nothing extra with no assessment — every non-WORK card', () => {
    render(<CommitmentRow commitment={card({ avoidance: null })} onAction={vi.fn()} />);

    expect(screen.queryByTestId('friction-prompt-c1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('break-it-down-c1')).not.toBeInTheDocument();
    expect(screen.queryByText(/put email and slack aside/i)).not.toBeInTheDocument();
  });

  it('offers nothing on a terminal row, whatever the ladder says', () => {
    render(
      <CommitmentRow
        commitment={card({
          status: 'COMPLETED',
          availableActions: [],
          avoidance: ladder('FRICTION_QUESTION'),
        })}
        onAction={vi.fn()}
        onAskFriction={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('friction-prompt-c1')).not.toBeInTheDocument();
  });
});
