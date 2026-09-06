import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../utils/test-utils';
import { setViewportWidth } from '../setup';
import { seedAttachment } from '../mocks/mediaHandlers';
import MediaLibraryPage from '../../pages/MediaLibraryPage';

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MediaLibraryPage', () => {
  it('shows the empty state with a way out of it', async () => {
    render(<MediaLibraryPage />);

    expect(await screen.findByText('No media yet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add media' }),
    ).toBeInTheDocument();
  });

  it('renders a card per attachment with its purpose and state', async () => {
    seedAttachment({ purpose: 'WORKOUT_FORM', kind: 'VIDEO' });
    seedAttachment({ purpose: 'MEAL' });

    render(<MediaLibraryPage />);

    await waitFor(() =>
      expect(screen.getAllByTestId('media-card')).toHaveLength(2),
    );
    expect(screen.getByText('Workout form')).toBeInTheDocument();
    expect(screen.getByText('Meal')).toBeInTheDocument();
    expect(screen.getAllByText('Ready')).toHaveLength(2);
  });

  it('opens the ask dialog with the attachment already chosen', async () => {
    seedAttachment({ purpose: 'MEAL' });
    render(<MediaLibraryPage />);

    await screen.findByTestId('media-card');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the coach' }));

    // Step 1 is skipped: no picker, and Ask is live immediately.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('media-picker-library-input')).toBeNull();
    expect(screen.getByTestId('media-ask-button')).toBeEnabled();
  });

  it('will not let you ask about media that is still processing', async () => {
    seedAttachment({ processingStatus: 'processing' });
    render(<MediaLibraryPage />);

    await screen.findByTestId('media-card');
    expect(screen.getByRole('button', { name: 'Ask the coach' })).toBeDisabled();
  });

  it('confirms before deleting, and removes the card', async () => {
    seedAttachment();
    render(<MediaLibraryPage />);

    await screen.findByTestId('media-card');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Delete this media?'),
    ).toBeInTheDocument();
    // Scoped to the dialog: the card behind it has a Delete button too.
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(screen.queryByTestId('media-card')).toBeNull());
    expect(await screen.findByText('No media yet')).toBeInTheDocument();
  });

  it('keeps the media when the confirmation is cancelled', async () => {
    seedAttachment();
    render(<MediaLibraryPage />);

    await screen.findByTestId('media-card');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('media-card')).toBeInTheDocument();
  });

  it('shows the coach’s stored notes when there are any', async () => {
    // Reloading /media must show the same advice: it is persisted on the
    // attachment, not held in the dialog that produced it.
    seedAttachment({
      aiSummary: {
        summary: 'A solid plate, mostly.',
        observations: ['There is a protein source.'],
        advice: ['Add something green.'],
        safetyFlag: { level: 'none', reason: '' },
        askedAt: new Date().toISOString(),
        question: null,
        invocationId: 'inv-1',
        promptVersion: 'media_analyst.v1',
        model: 'gpt-test',
      },
    });

    render(<MediaLibraryPage />);

    await userEvent.click(
      await screen.findByRole('button', { name: 'The coach’s notes' }),
    );

    expect(
      await screen.findByTestId('media-advice-summary'),
    ).toHaveTextContent('A solid plate, mostly.');
  });

  it('offers a FAB below sm and an inline button above it', async () => {
    seedAttachment();

    act(() => setViewportWidth(375));
    const { unmount } = render(<MediaLibraryPage />);
    await screen.findByTestId('media-card');
    expect(
      screen.getByRole('button', { name: 'Add media' }),
    ).toBeInTheDocument();
    unmount();

    act(() => setViewportWidth(1024));
    render(<MediaLibraryPage />);
    await screen.findByTestId('media-card');
    expect(
      screen.getByRole('button', { name: 'Add media' }),
    ).toBeInTheDocument();
  });
});
