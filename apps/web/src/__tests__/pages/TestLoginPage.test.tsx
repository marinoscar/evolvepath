/**
 * `/testing/login` (development only), and its two gate-skipping checkboxes.
 *
 * The interesting one is `withOnboarding` (#107, epic E04). It defaults to
 * CHECKED — the opposite of the key checkbox — and an unchecked HTML checkbox
 * sends nothing, so "absent" cannot mean both "the default" and "the user
 * unticked it". The hidden `withOnboarding=false` before it is what makes the
 * unticked state expressible at all, and these cases are what stop it being
 * deleted as dead markup.
 */

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../utils/test-utils';
import TestLoginPage from '../../pages/TestLoginPage';

function form(): HTMLFormElement {
  const element = document.querySelector('form');
  if (!element) throw new Error('the login form did not render');
  return element as HTMLFormElement;
}

/** What a native form POST would actually send. */
function submitted(): Array<[string, string]> {
  return [...new FormData(form()).entries()].map(
    ([key, value]) => [key, String(value)] as [string, string],
  );
}

describe('TestLoginPage', () => {
  it('posts to the non-production test login route', () => {
    render(<TestLoginPage />);

    expect(form().getAttribute('action')).toBe('/api/auth/test/login');
    expect(form().getAttribute('method')?.toUpperCase()).toBe('POST');
  });

  it('leaves the AI key unchecked — the keyless path is the one worth reaching by hand', () => {
    render(<TestLoginPage />);

    expect(screen.getByRole('checkbox', { name: /seed an openai key/i })).not.toBeChecked();
  });

  it('checks "mark onboarding complete" by default', () => {
    render(<TestLoginPage />);

    expect(
      screen.getByRole('checkbox', { name: /mark onboarding complete/i }),
    ).toBeChecked();
  });

  it('sends withOnboarding twice when checked, so the last value wins', async () => {
    const user = userEvent.setup();
    render(<TestLoginPage />);

    await user.type(screen.getByTestId('test-email-input'), 'someone@test.local');

    const values = submitted()
      .filter(([key]) => key === 'withOnboarding')
      .map(([, value]) => value);

    // The hidden input, then the checkbox — the standard HTML idiom.
    expect(values).toEqual(['false', 'on']);
  });

  it('sends only the hidden false when the box is unticked', async () => {
    const user = userEvent.setup();
    render(<TestLoginPage />);

    await user.click(screen.getByRole('checkbox', { name: /mark onboarding complete/i }));

    const values = submitted()
      .filter(([key]) => key === 'withOnboarding')
      .map(([, value]) => value);

    expect(values).toEqual(['false']);
  });
});
