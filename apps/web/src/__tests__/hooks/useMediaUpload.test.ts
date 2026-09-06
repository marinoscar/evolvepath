import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { useMediaUpload } from '../../hooks/useMediaUpload';
import { server } from '../mocks/server';
import { failNextUpload } from '../mocks/mediaHandlers';

const API_BASE = '*/api';

function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

// jsdom has no object URLs. Patch the two STATIC METHODS rather than stubbing
// the global: `URL` is a class, and `{ ...URL }` loses the constructor — which
// MSW and every handler that calls `new URL(request.url)` need.
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMediaUpload', () => {
  it('walks a small image through uploading, processing and ready', async () => {
    const onAttached = vi.fn();
    const { result } = renderHook(() =>
      useMediaUpload({ purpose: 'MEAL', onAttached }),
    );

    act(() => {
      result.current.addFiles([fakeFile('lunch.jpg', 'image/jpeg', 1024)]);
    });

    // `processing` is a real phase, not a formality: the server's work is not
    // over when the bytes land — the photo still has to be normalized.
    await waitFor(() => expect(result.current.items[0].phase).toBe('processing'));

    await waitFor(
      () => expect(result.current.items[0].phase).toBe('ready'),
      { timeout: 10000 },
    );

    expect(result.current.items[0].attachment?.processingStatus).toBe('ready');
    expect(onAttached).toHaveBeenCalledWith([
      expect.objectContaining({ processingStatus: 'ready' }),
    ]);
  }, 15000);

  it('refuses a .txt with NO network request at all', async () => {
    // PRD §123 has somebody at a squat rack; a round trip to learn that a text
    // file is not a video is a round trip wasted.
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => requests.push(request.url));

    const { result } = renderHook(() => useMediaUpload({ purpose: 'GENERAL' }));

    act(() => {
      result.current.addFiles([fakeFile('note.txt', 'text/plain', 10)]);
    });

    await waitFor(() => expect(result.current.items[0].phase).toBe('failed'));
    expect(result.current.items[0].error).toContain('is not allowed');
    expect(requests.filter((url) => url.includes('/storage/objects'))).toEqual(
      [],
    );

    server.events.removeAllListeners();
  });

  it('shows the server’s quota message verbatim on a 413', async () => {
    // No client-side paraphrase is more useful than a message naming the used
    // and quota bytes.
    failNextUpload(413, 'Storage quota exceeded: 900 of 1000 bytes used');

    const { result } = renderHook(() => useMediaUpload({ purpose: 'GENERAL' }));

    act(() => {
      result.current.addFiles([fakeFile('a.jpg', 'image/jpeg', 100)]);
    });

    await waitFor(() => expect(result.current.items[0].phase).toBe('failed'));
    expect(result.current.items[0].error).toBe(
      'Storage quota exceeded: 900 of 1000 bytes used',
    );
  });

  it('shows the server’s 400 message verbatim', async () => {
    failNextUpload(
      400,
      'File type "text/plain" is not allowed. Allowed: image/*, video/*',
    );

    const { result } = renderHook(() => useMediaUpload({ purpose: 'GENERAL' }));

    act(() => {
      // Passes local validation (empty type), so it reaches the server.
      result.current.addFiles([fakeFile('IMG.HEIC', '', 100)]);
    });

    await waitFor(() => expect(result.current.items[0].phase).toBe('failed'));
    expect(result.current.items[0].error).toContain('is not allowed');
  });

  it('goes through the resumable path for a file over 100 MiB', async () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => seen.push(request.url));

    const { result } = renderHook(() => useMediaUpload({ purpose: 'WORKOUT_FORM' }));

    act(() => {
      // 150 MiB — over the simple path's ceiling, so 15 parts at 10 MiB.
      result.current.addFiles([
        fakeFile('set.mp4', 'video/mp4', 150 * 1024 * 1024),
      ]);
    });

    await waitFor(
      () => expect(result.current.items[0].phase).toBe('ready'),
      { timeout: 15000 },
    );

    expect(seen.some((url) => url.includes('/upload/init'))).toBe(true);
    // The init response carries only ten URLs; parts 11-15 need the delta
    // route, without which the resumable path is a dead end.
    expect(seen.some((url) => url.includes('/upload/urls'))).toBe(true);
    expect(seen.filter((url) => url.startsWith('http://minio.test/part-'))).toHaveLength(15);
    expect(seen.some((url) => url.includes('/upload/complete'))).toBe(true);

    server.events.removeAllListeners();
  }, 25000);

  it('stops polling and reports the reason when processing fails', async () => {
    server.use(
      http.get(`${API_BASE}/media/attachments/:id`, ({ params }) =>
        HttpResponse.json({
          data: {
            id: params.id,
            storageObjectId: 'object-1',
            kind: 'VIDEO',
            purpose: 'WORKOUT_FORM',
            targetType: null,
            targetId: null,
            processingStatus: 'failed',
            processingError: 'video is 200s; the limit is 120s',
            media: {
              mimeType: 'video/mp4',
              size: '10',
              width: null,
              height: null,
              durationMs: null,
              frameCount: null,
            },
            aiSummary: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      ),
    );

    const { result } = renderHook(() =>
      useMediaUpload({ purpose: 'WORKOUT_FORM' }),
    );

    act(() => {
      result.current.addFiles([fakeFile('long.mp4', 'video/mp4', 1024)]);
    });

    await waitFor(
      () => expect(result.current.items[0].phase).toBe('failed'),
      { timeout: 10000 },
    );
    expect(result.current.items[0].error).toContain('120s');
  }, 15000);

  it('removes an item and revokes its object URL', async () => {
    const { result } = renderHook(() => useMediaUpload({ purpose: 'GENERAL' }));

    act(() => {
      result.current.addFiles([fakeFile('a.jpg', 'image/jpeg', 100)]);
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const localId = result.current.items[0].localId;
    act(() => result.current.remove(localId));

    expect(result.current.items).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('passes the target through to the attachment', async () => {
    const { result } = renderHook(() =>
      useMediaUpload({
        purpose: 'WORKOUT_FORM',
        targetType: 'workout_session',
        targetId: '11111111-1111-1111-1111-111111111111',
      }),
    );

    act(() => {
      result.current.addFiles([fakeFile('set.jpg', 'image/jpeg', 100)]);
    });

    await waitFor(
      () => expect(result.current.items[0].attachment).toBeDefined(),
      { timeout: 10000 },
    );
    expect(result.current.items[0].attachment?.targetType).toBe(
      'workout_session',
    );
  }, 15000);
});
