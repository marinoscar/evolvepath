import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../../utils/test-utils';
import { setViewportWidth } from '../../setup';
import { server } from '../../mocks/server';
import { setQuotaRemaining } from '../../mocks/mediaHandlers';
import { MediaAttachmentPicker } from '../../../components/media/MediaAttachmentPicker';

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

function fakeFile(name: string, type: string, size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  // jsdom has no object URLs. Patched as static methods, not by stubbing the
  // global: `URL` is a class and `{ ...URL }` would lose the constructor.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MediaAttachmentPicker', () => {
  describe('below sm — the phone', () => {
    beforeEach(() => act(() => setViewportWidth(375)));

    it('shows a camera button whose input opens the rear camera', () => {
      // PRD §123 puts intervention near the moment of action: a form check
      // that opens a file browser in a gym is a feature nobody uses.
      render(
        <MediaAttachmentPicker purpose="WORKOUT_FORM" onAttached={vi.fn()} />,
      );

      expect(
        screen.getByRole('button', { name: 'Take photo or video' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add photos/ })).toBeNull();

      const input = screen.getByTestId('media-picker-input');
      expect(input).toHaveAttribute('capture', 'environment');
      expect(input).toHaveAttribute('accept', 'image/*,video/*');
    });

    it('still offers the library, for a video already filmed', () => {
      render(<MediaAttachmentPicker purpose="MEAL" onAttached={vi.fn()} />);

      expect(
        screen.getByRole('button', { name: 'Choose from library' }),
      ).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
      const { container } = render(
        <MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />,
      );

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  });

  describe('at sm and above — the desktop', () => {
    beforeEach(() => act(() => setViewportWidth(1024)));

    it('shows a drop zone and a Choose files button', () => {
      render(<MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />);

      expect(
        screen.getByRole('button', { name: 'Add photos or videos' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Choose files' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Take photo or video' }),
      ).toBeNull();
    });

    it('opens the file dialog on Enter', async () => {
      render(<MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />);

      const input = screen.getByTestId('media-picker-library-input');
      const click = vi.spyOn(input, 'click');

      const zone = screen.getByRole('button', { name: 'Add photos or videos' });
      zone.focus();
      await userEvent.keyboard('{Enter}');

      expect(click).toHaveBeenCalled();
    });

    it('has no accessibility violations', async () => {
      const { container } = render(
        <MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />,
      );

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  });

  it('refuses a dropped .txt with the server’s message and NO network request', async () => {
    // DROPPED rather than picked: `userEvent.upload` honours the input's
    // `accept`, so a `.txt` never reaches the handler through that path — the
    // browser filters it. Drag and drop does not, which is exactly why the
    // client-side check exists.
    act(() => setViewportWidth(1024));

    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => requests.push(request.url));

    render(<MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />);

    const file = fakeFile('note.txt', 'text/plain');
    fireEvent.drop(screen.getByRole('button', { name: 'Add photos or videos' }), {
      dataTransfer: { files: [file] },
    });

    expect(
      await screen.findByText(/Failed: File type "text\/plain" is not allowed/),
    ).toBeInTheDocument();
    expect(requests.filter((url) => url.includes('/storage/objects'))).toEqual(
      [],
    );

    server.events.removeAllListeners();
  });

  it('walks a JPEG to Ready and calls onAttached', async () => {
    const onAttached = vi.fn();
    render(<MediaAttachmentPicker purpose="MEAL" onAttached={onAttached} />);

    await userEvent.upload(
      screen.getByTestId('media-picker-library-input'),
      fakeFile('lunch.jpg', 'image/jpeg'),
    );

    // Every phase carries an icon AND TEXT: PRD §122 forbids status conveyed
    // by colour alone.
    await waitFor(
      () => expect(screen.getByTestId('media-item-status')).toHaveTextContent('Ready'),
      { timeout: 10000 },
    );
    expect(onAttached).toHaveBeenCalledWith([
      expect.objectContaining({ processingStatus: 'ready' }),
    ]);
  }, 15000);

  it('shows Processing… before Ready for a video', async () => {
    render(
      <MediaAttachmentPicker purpose="WORKOUT_FORM" onAttached={vi.fn()} />,
    );

    await userEvent.upload(
      screen.getByTestId('media-picker-library-input'),
      fakeFile('set.mp4', 'video/mp4'),
    );

    await waitFor(() =>
      expect(screen.getByTestId('media-item-status')).toHaveTextContent(
        'Processing…',
      ),
    );
    await waitFor(
      () =>
        expect(screen.getByTestId('media-item-status')).toHaveTextContent(
          'Ready',
        ),
      { timeout: 10000 },
    );
  }, 15000);

  it('removes an item and revokes its object URL', async () => {
    render(<MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />);

    await userEvent.upload(
      screen.getByTestId('media-picker-library-input'),
      fakeFile('a.jpg', 'image/jpeg'),
    );
    await screen.findByTestId('media-item');

    await userEvent.click(screen.getByRole('button', { name: 'Remove a.jpg' }));

    expect(screen.queryByTestId('media-item')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('stops accepting files at maxFiles', async () => {
    render(
      <MediaAttachmentPicker
        purpose="GENERAL"
        maxFiles={1}
        onAttached={vi.fn()}
      />,
    );

    await userEvent.upload(
      screen.getByTestId('media-picker-library-input'),
      fakeFile('a.jpg', 'image/jpeg'),
    );
    await screen.findByTestId('media-item');

    expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled();
  });

  it('shows the remaining quota, and nothing when quotas are off', async () => {
    const { unmount } = render(
      <MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />,
    );

    expect(await screen.findByText(/of storage left/)).toBeInTheDocument();
    unmount();

    // null rather than a very large number, so the caption disappears instead
    // of claiming a ceiling that does not exist.
    setQuotaRemaining(null);
    render(<MediaAttachmentPicker purpose="GENERAL" onAttached={vi.fn()} />);

    await waitFor(() =>
      expect(screen.queryByText(/of storage left/)).toBeNull(),
    );
  });
});
