import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { ImageUpload } from '../../../components/settings/ImageUpload';

function fakeFile(name: string, type: string, size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('ImageUpload', () => {
  it('uploads through the real storage endpoint and hands back a signed URL', async () => {
    // It used to post a raw `fetch` to `/api/users/profile-image` — an
    // endpoint that has never existed — bypassing ApiService, and therefore
    // token refresh and the error envelope with it.
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => requests.push(request.url));

    const onUpload = vi.fn();
    render(<ImageUpload onUpload={onUpload} />);

    await userEvent.upload(
      document.querySelector('input[type="file"]')!,
      fakeFile('avatar.png', 'image/png'),
    );

    await waitFor(() => expect(onUpload).toHaveBeenCalled(), { timeout: 10000 });
    expect(onUpload.mock.calls[0][0]).toContain('http://minio.test/download/');

    expect(requests.some((url) => url.includes('/storage/objects'))).toBe(true);
    // The dead endpoint is never called.
    expect(requests.some((url) => url.includes('/users/profile-image'))).toBe(
      false,
    );

    server.events.removeAllListeners();
  }, 15000);

  it('refuses a non-image without a network request', async () => {
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => requests.push(request.url));

    render(<ImageUpload onUpload={vi.fn()} />);

    const input = document.querySelector('input[type="file"]')!;
    // `accept` would filter this at the picker, so it is dispatched directly.
    await userEvent.upload(input, fakeFile('doc.pdf', 'application/pdf'), {
      applyAccept: false,
    });

    expect(
      await screen.findByText(/Please select a valid image file/),
    ).toBeInTheDocument();
    expect(requests.filter((url) => url.includes('/storage/objects'))).toEqual(
      [],
    );

    server.events.removeAllListeners();
  });

  it('refuses a file over its own 5 MB limit', async () => {
    render(<ImageUpload onUpload={vi.fn()} />);

    await userEvent.upload(
      document.querySelector('input[type="file"]')!,
      fakeFile('huge.png', 'image/png', 6 * 1024 * 1024),
    );

    expect(
      await screen.findByText('File size must be less than 5MB'),
    ).toBeInTheDocument();
  });

  it('is disabled while an upload is running', async () => {
    render(<ImageUpload onUpload={vi.fn()} />);

    await userEvent.upload(
      document.querySelector('input[type="file"]')!,
      fakeFile('avatar.png', 'image/png'),
    );

    expect(await screen.findByText('Uploading...')).toBeInTheDocument();
  });
});
