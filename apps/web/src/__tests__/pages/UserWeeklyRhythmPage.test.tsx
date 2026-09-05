import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import { weeklyState } from '../mocks/weeklyHandlers';
import UserWeeklyRhythmPage from '../../pages/UserWeeklyRhythmPage';

// =============================================================================
// /settings/weekly-rhythm (issue #84, epic E10)
// =============================================================================

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

function renderPage() {
  return render(
    <Routes>
      <Route path="/settings/weekly-rhythm" element={<UserWeeklyRhythmPage />} />
    </Routes>,
    { wrapperOptions: { route: '/settings/weekly-rhythm' } },
  );
}

describe('UserWeeklyRhythmPage (#84)', () => {
  it('loads the stored day and time', async () => {
    renderPage();

    expect(await screen.findByText('Sunday')).toBeInTheDocument();
    expect(screen.getByTestId('rhythm-time')).toHaveValue('17:00');
  });

  it('shows when the next review is, in the timezone it will run in', async () => {
    renderPage();

    // From the server's `nextReviewAt`, not derived locally: the page shows the
    // answer the sweep will actually act on.
    expect(await screen.findByText(/^Next review:/)).toBeInTheDocument();
    expect(screen.getByText(/America\/Costa_Rica/)).toBeInTheDocument();
  });

  it('saves the chosen day and time and confirms it', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('rhythm-weekday');

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Friday' }));

    const time = screen.getByTestId('rhythm-time');
    await user.clear(time);
    await user.type(time, '16:00');

    await user.click(screen.getByTestId('rhythm-save'));

    await waitFor(() =>
      expect(weeklyState().settings).toMatchObject({
        weeklyReviewWeekday: 5,
        weeklyReviewTime: '16:00',
      }),
    );

    expect(await screen.findByText('Weekly rhythm saved')).toBeInTheDocument();
  });

  it('says the sweep is hourly rather than promising the minutes', async () => {
    renderPage();

    expect(
      await screen.findByText(/Reviews are prepared on the hour/i),
    ).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderPage();

    await screen.findByTestId('rhythm-save');

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
