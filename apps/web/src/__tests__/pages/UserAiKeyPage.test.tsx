import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render, mockUser } from '../utils/test-utils';
import { server } from '../mocks/server';
import { resetAiKeyState, setAiKeyConfigured } from '../mocks/handlers';
import UserAiKeyPage from '../../pages/UserAiKeyPage';

const renderPage = () => render(<UserAiKeyPage />, { wrapperOptions: { user: mockUser } });

describe('UserAiKeyPage', () => {
  beforeEach(() => {
    server.resetHandlers();
    resetAiKeyState();
  });

  it('names the page as the registry card does', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'OpenAI API Key' })).toBeInTheDocument();
    expect(screen.getByText(/stored encrypted and never shown again/)).toBeInTheDocument();
  });

  it('collapses the instructions on this page', async () => {
    renderPage();

    expect(screen.getByText('How do I get a key?')).toBeInTheDocument();
    expect(screen.getByText(/Create new secret key/)).not.toBeVisible();
  });

  it('shows the stored status once loaded', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Configured/)).toBeInTheDocument());
    expect(screen.getByLabelText('Replace key')).toBeInTheDocument();
  });

  it('saves a key and updates the status line', async () => {
    setAiKeyConfigured(false);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('No key saved')).toBeInTheDocument());

    await user.type(screen.getByLabelText('OpenAI API key'), 'sk-a-good-key-00000000');
    await user.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(screen.getByText(/Configured/)).toBeInTheDocument());
  });

  it('offers Remove, which this page does have unlike the setup screen', async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument(),
    );
  });
});
