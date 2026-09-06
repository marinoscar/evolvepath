import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import { progressTimelineDomains } from '../mocks/progressHandlers';
import ProgressTimelinePage from '../../pages/ProgressTimelinePage';

// =============================================================================
// The full evidence list (issue #117, epic E11)
// =============================================================================
//
// The two behaviours only this page has: the domain filter reaches the SERVER
// (a client-side filter would silently lie about the pages it had not fetched),
// and Load more appends rather than replaces.
// =============================================================================

async function renderPage() {
  const view = render(<ProgressTimelinePage />, { user: mockAdminUser });
  await screen.findByRole('heading', { level: 1, name: 'Evidence' });
  return view;
}

describe('ProgressTimelinePage (#117)', () => {
  it('lists the first page of events', async () => {
    await renderPage();

    expect(await screen.findByText('Protected family dinner')).toBeInTheDocument();
  });

  it('asks the server for the filtered domain', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Protected family dinner');

    await user.click(screen.getByRole('button', { name: 'Family' }));

    await waitFor(() => expect(progressTimelineDomains()).toContain('FAMILY'));
  });

  it('appends the next page rather than replacing it', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Protected family dinner');

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(
      await screen.findByText('Completed Upper A — minimum version'),
    ).toBeInTheDocument();
    // Page one is still there.
    expect(screen.getByText('Protected family dinner')).toBeInTheDocument();
  });

  it('stops offering more when the history is exhausted', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Protected family dinner');

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Completed Upper A — minimum version');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = await renderPage();
    await screen.findByText('Protected family dinner');

    expect(await axe(container)).toHaveNoViolations();
  });
});
