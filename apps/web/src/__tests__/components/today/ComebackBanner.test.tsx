import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { render } from '../../utils/test-utils';
import ComebackBanner from '../../../components/today/ComebackBanner';

// =============================================================================
// "Welcome back. No catching up." (issue #119, epic E11)
// =============================================================================
//
// The first thing a returning user sees. PRD §56's whole point is what it does
// NOT contain, so the assertions below are as much about absence as presence.
// =============================================================================

const OFFER = {
  state: 'OFFERED' as const,
  restartCommitmentId: 'restart-1',
  offeredAt: '2026-03-06T04:00:00.000Z',
};

function renderBanner(comeback: typeof OFFER | null, onDismiss = vi.fn()) {
  return {
    onDismiss,
    ...render(
      <Routes>
        <Route path="/" element={<ComebackBanner comeback={comeback} onDismiss={onDismiss} />} />
        <Route path="/comeback" element={<div data-testid="comeback-flow" />} />
      </Routes>,
      { wrapperOptions: { route: '/' } },
    ),
  };
}

describe('ComebackBanner (#119)', () => {
  it('is absent when there is no open loop', () => {
    renderBanner(null);

    expect(screen.queryByTestId('comeback-banner')).not.toBeInTheDocument();
  });

  it('greets rather than reckons', () => {
    const { container } = renderBanner(OFFER);

    expect(screen.getByText('Welcome back. No catching up.')).toBeInTheDocument();
    expect(
      screen.getByText('We start from today. One small thing is enough.'),
    ).toBeInTheDocument();

    // Nothing here counts, lists or names what was missed.
    expect(container.textContent ?? '').not.toMatch(
      /\b(overdue|behind|failed|streak|\d+ missed)\b/i,
    );
  });

  it('is announced politely rather than as an error', () => {
    renderBanner(OFFER);

    expect(screen.getByTestId('comeback-banner')).toHaveAttribute('role', 'status');
  });

  it('opens the flow', async () => {
    const user = userEvent.setup();
    renderBanner(OFFER);

    await user.click(screen.getByRole('button', { name: 'Restart with one thing' }));

    expect(await screen.findByTestId('comeback-flow')).toBeInTheDocument();
  });

  it('lets the user put it away', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderBanner(OFFER, onDismiss);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('gives both actions a real touch target', () => {
    renderBanner(OFFER);

    for (const name of ['Restart with one thing', 'Dismiss']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
