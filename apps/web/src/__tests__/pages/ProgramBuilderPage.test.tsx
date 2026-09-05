import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import { ProgramBuilderPage } from '../../pages/ProgramBuilderPage';
import {
  approveRequests,
  deletedPrograms,
  generateRequests,
  setGenerateStatus,
  setNextGenerateResult,
} from '../mocks/workoutHandlers';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

/** Walk the four steps and press Generate. */
async function completeWizard(user: ReturnType<typeof userEvent.setup>, goal = 'Get stronger') {
  await user.type(screen.getByLabelText(/What do you want out of training/), goal);
  await user.click(screen.getByRole('button', { name: 'Next' }));

  await user.click(screen.getByRole('button', { name: '4' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));

  await user.click(screen.getByRole('button', { name: 'Dumbbells' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));

  await user.type(screen.getByLabelText(/Anything your body can't do/), 'bad left shoulder');
  await user.click(screen.getByRole('button', { name: 'Generate' }));
}

describe('ProgramBuilderPage', () => {
  it('posts exactly the seven inputs PRD §37 asks for', async () => {
    const user = userEvent.setup();
    render(<ProgramBuilderPage />);

    await completeWizard(user);

    await waitFor(() => expect(generateRequests()).toHaveLength(1));
    expect(generateRequests()[0]).toEqual({
      goal: 'Get stronger',
      experience: 'BEGINNER',
      daysPerWeek: 4,
      minutesPerSession: 40,
      equipment: ['BODYWEIGHT', 'DUMBBELL'],
      limitations: 'bad left shoulder',
    });
  });

  it('will not generate without a goal', async () => {
    render(<ProgramBuilderPage />);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows the draft with a table per workout and all three versions', async () => {
    const user = userEvent.setup();
    render(<ProgramBuilderPage />);

    await completeWizard(user);

    expect(await screen.findByText('Two-day upper/lower')).toBeInTheDocument();

    const upper = screen.getByRole('region', { name: 'Upper A' });
    expect(within(upper).getByRole('tab', { name: 'Full' })).toBeInTheDocument();
    expect(within(upper).getByRole('tab', { name: 'Short' })).toBeInTheDocument();
    expect(within(upper).getByRole('tab', { name: 'Minimum' })).toBeInTheDocument();

    // PRD §44's promise, said out loud rather than hidden in a tooltip.
    expect(
      screen.getByText(/they are not the same training stimulus/),
    ).toBeInTheDocument();
  });

  it('switches the table when a smaller version is chosen', async () => {
    const user = userEvent.setup();
    render(<ProgramBuilderPage />);
    await completeWizard(user);

    const upper = await screen.findByRole('region', { name: 'Upper A' });
    expect(within(upper).getByText('About 40 minutes')).toBeInTheDocument();

    await user.click(within(upper).getByRole('tab', { name: 'Minimum' }));

    expect(within(upper).getByText('About 10 minutes')).toBeInTheDocument();
  });

  it('explains a starter program differently for each reason it happened', async () => {
    const user = userEvent.setup();
    setNextGenerateResult({ source: 'starter', reason: 'ai_unavailable' });
    render(<ProgramBuilderPage />);

    await completeWizard(user);

    expect(await screen.findByText(/coach is unavailable right now/)).toBeInTheDocument();
    // A fallback is still approvable — that is the whole point of PRD §120.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('says something different when the draft broke a safety rule', async () => {
    const user = userEvent.setup();
    setNextGenerateResult({ source: 'starter', reason: 'invalid_output' });
    render(<ProgramBuilderPage />);

    await completeWizard(user);

    expect(await screen.findByText(/broke one of our safety rules/)).toBeInTheDocument();
  });

  it('points at the key page rather than failing quietly when there is no key', async () => {
    const user = userEvent.setup();
    setGenerateStatus(412);
    render(<ProgramBuilderPage />);

    await completeWizard(user);

    expect(await screen.findByRole('link', { name: 'Add a key' })).toHaveAttribute(
      'href',
      '/settings/ai-key',
    );
  });

  it('approves with a time and a start date, then lands on the program', async () => {
    const user = userEvent.setup();
    render(<ProgramBuilderPage />);
    await completeWizard(user);

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveRequests()).toHaveLength(1));
    expect(approveRequests()[0].body.preferredTime).toBe('07:00');
    expect(approveRequests()[0].body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mockNavigate).toHaveBeenCalledWith(
      `/health/programs/${approveRequests()[0].id}`,
      expect.objectContaining({
        state: { notice: 'Your first two weeks are on Today' },
      }),
    );
  });

  it('throws away the previous draft when regenerating', async () => {
    const user = userEvent.setup();
    render(<ProgramBuilderPage />);
    await completeWizard(user);

    await user.click(await screen.findByRole('button', { name: 'Regenerate' }));

    // Otherwise four presses would leave four abandoned programs in a list
    // that is meant to say what training you have.
    await waitFor(() => expect(deletedPrograms()).toEqual(['program-1']));
    await waitFor(() => expect(generateRequests()).toHaveLength(2));
    expect(generateRequests()[1]).toEqual(generateRequests()[0]);
  });

  it('has no accessibility violations on the wizard or the review', async () => {
    const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };
    const user = userEvent.setup();
    const { container } = render(<ProgramBuilderPage />);

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();

    await completeWizard(user);
    await screen.findByText('Two-day upper/lower');

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
