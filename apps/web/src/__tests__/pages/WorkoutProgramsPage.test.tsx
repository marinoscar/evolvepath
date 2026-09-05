import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import { setViewportWidth } from '../setup';
import { WorkoutProgramsPage } from '../../pages/WorkoutProgramsPage';
import { buildProgram, seedPrograms } from '../mocks/workoutHandlers';

const PHONE = 375;
const DESKTOP = 1024;

function renderPage() {
  return render(<WorkoutProgramsPage />);
}

describe('WorkoutProgramsPage', () => {
  it('offers one obvious way out of an empty state', async () => {
    renderPage();

    expect(await screen.findByText('No program yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Build a program' })[0]).toHaveAttribute(
      'href',
      '/health/programs/new',
    );
  });

  it('lists the programs the user has', async () => {
    seedPrograms([
      buildProgram({ id: 'p1', name: 'Two-day upper/lower', status: 'ACTIVE' }),
      buildProgram({ id: 'p2', name: 'Old program', status: 'ARCHIVED' }),
    ]);
    renderPage();

    expect(await screen.findByText('Two-day upper/lower')).toBeInTheDocument();
    expect(screen.getByText('Old program')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getAllByText('2 days a week · 6 weeks')).toHaveLength(2);
  });

  it('calls a draft "not started" rather than showing the enum', async () => {
    seedPrograms([buildProgram({ id: 'p1', status: 'DRAFT' })]);
    renderPage();

    expect(await screen.findByText('Not started')).toBeInTheDocument();
  });

  it('puts the build action in the header above the phone breakpoint', async () => {
    act(() => setViewportWidth(DESKTOP));
    seedPrograms([buildProgram()]);
    renderPage();

    await screen.findByTestId('program-grid');
    expect(screen.queryByLabelText('Build a program')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Build a program' })).toBeInTheDocument();
  });

  it('uses a floating action button on a phone', async () => {
    act(() => setViewportWidth(PHONE));
    seedPrograms([buildProgram()]);
    renderPage();

    await screen.findByTestId('program-grid');
    expect(screen.getByLabelText('Build a program')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    seedPrograms([buildProgram()]);
    const { container } = renderPage();

    await screen.findByTestId('program-grid');

    expect(
      await axe(container, { rules: { 'color-contrast': { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
