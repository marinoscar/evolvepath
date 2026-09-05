import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import { setViewportWidth } from '../setup';
import { WorkoutProgramPage } from '../../pages/WorkoutProgramPage';
import { buildProgram, seedPrograms } from '../mocks/workoutHandlers';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

const PHONE = 375;
const DESKTOP = 1024;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ programId: 'program-1' }) };
});

describe('WorkoutProgramPage', () => {
  it('shows the whole week, rest days included', async () => {
    act(() => setViewportWidth(DESKTOP));
    seedPrograms([buildProgram({ id: 'program-1', status: 'ACTIVE' })]);
    render(<WorkoutProgramPage />);

    const week = await screen.findByRole('list', { name: 'Training week' });

    // All seven cells: a list of only the training days would make a spaced
    // week and a bunched one look identical.
    expect(within(week).getAllByRole('listitem')).toHaveLength(7);
    expect(within(week).getAllByText('Rest')).toHaveLength(5);
    expect(within(week).getByText('Upper A')).toBeInTheDocument();
  });

  it('says the small versions are not equivalent', async () => {
    seedPrograms([buildProgram({ id: 'program-1', status: 'ACTIVE' })]);
    render(<WorkoutProgramPage />);

    expect(
      await screen.findByText(/they are not the same training stimulus/),
    ).toBeInTheDocument();
  });

  it('renders a table above the phone breakpoint and cards below it', async () => {
    seedPrograms([buildProgram({ id: 'program-1', status: 'ACTIVE' })]);

    act(() => setViewportWidth(DESKTOP));
    const wide = render(<WorkoutProgramPage />);
    expect(await screen.findAllByRole('table')).not.toHaveLength(0);
    wide.unmount();

    act(() => setViewportWidth(PHONE));
    render(<WorkoutProgramPage />);
    await screen.findByRole('heading', { name: 'Two-day upper/lower' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the catalog instructions behind a disclosure on a phone', async () => {
    act(() => setViewportWidth(PHONE));
    seedPrograms([buildProgram({ id: 'program-1', status: 'ACTIVE' })]);
    const user = userEvent.setup();
    render(<WorkoutProgramPage />);

    const toggle = await screen.findByRole('button', {
      name: 'How to do Dumbbell Bench Press',
    });
    await user.click(toggle);

    expect(
      await screen.findByText(/Press both dumbbells up until your arms are straight/),
    ).toBeInTheDocument();
  });

  it('says when the coach has suggested a change, and where to read it', async () => {
    seedPrograms([buildProgram({ id: 'program-1', status: 'ACTIVE' })]);
    server.use(
      http.get('*/api/proposals', () =>
        HttpResponse.json({
          data: [
            {
              id: 'proposal-1',
              status: 'PROPOSED',
              sourceKind: 'WORKOUT',
              summary: 'Shall we make Upper A 25 minutes?',
            },
          ],
        }),
      ),
    );
    render(<WorkoutProgramPage />);

    expect(
      await screen.findByText('Your coach has suggested a change to this program.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read it' })).toHaveAttribute('href', '/coach');
  });

  it('archives only after asking, and says what that costs', async () => {
    seedPrograms([buildProgram({ id: 'program-1', status: 'ACTIVE' })]);
    const user = userEvent.setup();
    render(<WorkoutProgramPage />);

    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/still to come are cancelled/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(screen.getByText('archived')).toBeInTheDocument());
  });

  it('renders a not-found state rather than redirecting a mistyped id', async () => {
    render(<WorkoutProgramPage />);

    // The API answers 404 for a foreign id exactly as for one that never
    // existed; a redirect would make a mistyped URL look like a working one.
    expect(await screen.findByText('That program is not here')).toBeInTheDocument();
  });

  // jsdom performs no layout, so `color-contrast` is a known false-negative
  // trap — the same exclusion the datatable conformance suite documents.
  const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

  it.each([
    ['a phone', PHONE],
    ['a desktop', DESKTOP],
  ])('has no accessibility violations on %s', async (_label, width) => {
    act(() => setViewportWidth(width));
    seedPrograms([buildProgram({ id: 'program-1', status: 'ACTIVE' })]);
    const { container } = render(<WorkoutProgramPage />);

    await screen.findByRole('heading', { name: 'Two-day upper/lower' });

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
