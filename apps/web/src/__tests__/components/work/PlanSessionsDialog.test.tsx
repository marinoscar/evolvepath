import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { PlanSessionsDialog } from '../../../components/work/PlanSessionsDialog';
import {
  lastAppliedPlan,
  setAiKeyMissing,
  setApplyRejects,
  setCoachDown,
} from '../../mocks/workHandlers';
import type { Outcome } from '../../../types';

// =============================================================================
// Propose → review → apply (issue #118, epic E07)
// =============================================================================
//
// The assertion that matters most is the third one: an edited duration reaches
// the `apply` body. PRD §15 makes the review step the approval, and a dialog
// that showed edits it did not send would be an approval of something else.
// =============================================================================

const outcome = {
  id: 'outcome-1',
  domain: 'WORK',
  title: 'Finish the strategy presentation',
  targetDate: '2026-09-30',
  importance: 4,
  state: 'ACTIVE',
} as unknown as Outcome;

function renderDialog(overrides: Partial<Parameters<typeof PlanSessionsDialog>[0]> = {}) {
  const props = {
    open: true,
    outcome,
    hasSessions: false,
    onClose: vi.fn(),
    onApplied: vi.fn(),
    ...overrides,
  };

  return { ...render(<PlanSessionsDialog {...props} />), props };
}

async function propose() {
  await userEvent.click(screen.getByTestId('plan-sessions-propose'));
  return screen.findByTestId('plan-sessions-apply');
}

describe('PlanSessionsDialog', () => {
  it('proposes, and shows the milestones and sessions to review', async () => {
    renderDialog();
    await propose();

    expect(screen.getByDisplayValue('Clarify what done looks like')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue(/storyline part/)).toHaveLength(5);
    expect(screen.getByDisplayValue('After I sit down with coffee')).toBeInTheDocument();
  });

  it('applies the plan and reports how many sessions were created', async () => {
    const { props } = renderDialog();
    await propose();

    await userEvent.click(screen.getByTestId('plan-sessions-apply'));

    expect(props.onApplied).toHaveBeenCalledWith(5);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('sends the edited duration, not the proposed one', async () => {
    renderDialog();
    await propose();

    const minutes = screen.getByTestId('session-minutes-0');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '20');

    await userEvent.click(screen.getByTestId('plan-sessions-apply'));

    expect(lastAppliedPlan?.sessions[0].durationMinutes).toBe(20);
  });

  it('sends an edited milestone title too', async () => {
    renderDialog();
    await propose();

    const title = screen.getByDisplayValue('Refine and finish');
    await userEvent.clear(title);
    await userEvent.type(title, 'Ship it');

    await userEvent.click(screen.getByTestId('plan-sessions-apply'));

    expect(lastAppliedPlan?.milestones.map((m) => m.title)).toContain('Ship it');
  });

  it('offers a standard plan when the coach is down, and applying it works', async () => {
    setCoachDown(true);
    const { props } = renderDialog();

    await userEvent.click(screen.getByTestId('plan-sessions-propose'));

    expect(await screen.findByTestId('coach-unavailable')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('use-standard-plan'));
    await screen.findByTestId('plan-sessions-apply');
    await userEvent.click(screen.getByTestId('plan-sessions-apply'));

    expect(props.onApplied).toHaveBeenCalledWith(5);
  });

  it('links to the key page when the caller has no key', async () => {
    setAiKeyMissing(true);
    renderDialog();

    await userEvent.click(screen.getByTestId('plan-sessions-propose'));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: /add one/i })).toHaveAttribute(
      'href',
      '/settings/ai-key',
    );
  });

  it('renders the guardrail rules the server refused on', async () => {
    setApplyRejects(['3 sessions on 2026-09-08 — at most 2 fit in a day.']);
    renderDialog();
    await propose();

    await userEvent.click(screen.getByTestId('plan-sessions-apply'));

    expect(
      await screen.findByText(/at most 2 fit in a day/i),
    ).toBeInTheDocument();
  });

  it('labels the button "Plan more sessions" when there already are some', () => {
    renderDialog({ hasSessions: true });

    expect(screen.getByText('Plan more sessions')).toBeInTheDocument();
  });
});
