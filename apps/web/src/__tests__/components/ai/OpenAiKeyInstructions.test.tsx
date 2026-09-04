import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OpenAiKeyInstructions } from '../../../components/ai/OpenAiKeyInstructions';

describe('OpenAiKeyInstructions', () => {
  it('opens the platform link safely in a new tab', () => {
    render(<OpenAiKeyInstructions variant="setup" />);

    const link = screen.getByRole('link', { name: 'platform.openai.com' });
    expect(link).toHaveAttribute('href', 'https://platform.openai.com/api-keys');
    expect(link).toHaveAttribute('target', '_blank');
    // Without `noopener` the opened page gets a `window.opener` handle back
    // into this origin.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders the steps open in the setup variant', () => {
    // First login: the user has never done this and cannot proceed without it.
    render(<OpenAiKeyInstructions variant="setup" />);

    expect(screen.getByText(/Create new secret key/)).toBeVisible();
    expect(screen.getByText(/Billing must be enabled/)).toBeVisible();
  });

  it('collapses the steps behind a summary in the settings variant', async () => {
    // Replacing a key: the user already knows how.
    const user = userEvent.setup();
    render(<OpenAiKeyInstructions variant="settings" />);

    expect(screen.getByText('How do I get a key?')).toBeInTheDocument();
    expect(screen.getByText(/Create new secret key/)).not.toBeVisible();

    await user.click(screen.getByText('How do I get a key?'));

    expect(screen.getByText(/Create new secret key/)).toBeVisible();
  });

  it('warns about billing in both variants', () => {
    // The single most common reason a correctly-copied key fails.
    const { unmount } = render(<OpenAiKeyInstructions variant="setup" />);
    expect(screen.getByText(/Billing must be enabled/)).toBeInTheDocument();
    unmount();

    render(<OpenAiKeyInstructions variant="settings" />);
    expect(screen.getByText(/Billing must be enabled/)).toBeInTheDocument();
  });
});
