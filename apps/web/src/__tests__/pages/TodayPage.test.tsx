import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import TodayPage from '../../pages/TodayPage';

/**
 * Today is a placeholder until E05, so what is worth testing is the one thing
 * it has to do NOW: give a new user somewhere to go.
 */
describe('TodayPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Freezes the clock so the greeting is not a function of when CI runs. */
  function atHour(hour: number) {
    vi.useFakeTimers();
    const when = new Date();
    when.setHours(hour, 0, 0, 0);
    vi.setSystemTime(when);
  }

  it('greets the user by display name', () => {
    atHour(9);
    render(<TodayPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(
      screen.getByRole('heading', { level: 1, name: `Good morning, ${mockAdminUser.displayName}` }),
    ).toBeInTheDocument();
  });

  it('falls back to "there" rather than an empty name', () => {
    atHour(14);
    render(<TodayPage />, {
      wrapperOptions: { user: { ...mockAdminUser, displayName: null } },
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Good afternoon, there' }),
    ).toBeInTheDocument();
  });

  it('points an empty Path at the Path screen', () => {
    render(<TodayPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(screen.getByTestId('today-empty-state')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Path' })).toHaveAttribute('href', '/path');
  });

  it('has exactly one h1', () => {
    render(<TodayPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('has no axe violations', async () => {
    const { container } = render(<TodayPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(await axe(container)).toHaveNoViolations();
  });
});
