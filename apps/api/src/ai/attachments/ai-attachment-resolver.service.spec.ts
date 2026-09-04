import { Readable } from 'node:stream';
import { NotFoundException } from '@nestjs/common';

import { AiAttachmentResolverService } from './ai-attachment-resolver.service';
import { createMockStorageProvider } from '../../../test/mocks/storage-provider.mock';

const USER_ID = 'user-1';

function config(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'ai.attachments.maxImageBytes': 1024,
    'ai.attachments.maxImagesPerCall': 10,
    'ai.attachments.mode': 'inline',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as never;
}

describe('AiAttachmentResolverService', () => {
  let objects: { getById: jest.Mock };
  let storage: ReturnType<typeof createMockStorageProvider>;
  let prisma: { storageObject: { findUnique: jest.Mock } };

  function build(overrides?: Record<string, unknown>) {
    return new AiAttachmentResolverService(
      objects as never,
      storage,
      prisma as never,
      config(overrides),
    );
  }

  function imageObject(id: string) {
    return { id, mimeType: 'image/jpeg', status: 'ready', metadata: null };
  }

  beforeEach(() => {
    objects = { getById: jest.fn() };
    storage = createMockStorageProvider();
    storage.download.mockResolvedValue(Readable.from([Buffer.from('ABC')]));
    prisma = {
      storageObject: {
        findUnique: jest.fn().mockResolvedValue({ storageKey: 'key/1' }),
      },
    };
  });

  it('returns nothing for an absent or empty attachment list', async () => {
    await expect(build().resolve(USER_ID, undefined)).resolves.toEqual([]);
    await expect(build().resolve(USER_ID, [])).resolves.toEqual([]);
    expect(objects.getById).not.toHaveBeenCalled();
  });

  it('inlines an image with its real mime type and requested detail', async () => {
    objects.getById.mockResolvedValue(imageObject('obj-1'));

    const parts = await build().resolve(USER_ID, [
      { storageObjectId: 'obj-1', detail: 'high' },
    ]);

    expect(objects.getById).toHaveBeenCalledWith('obj-1', USER_ID);
    expect(parts).toEqual([
      {
        type: 'image',
        mimeType: 'image/jpeg',
        base64: Buffer.from('ABC').toString('base64'),
        detail: 'high',
      },
    ]);
  });

  it('refuses an object the caller does not own, without saying whether it exists', async () => {
    objects.getById.mockRejectedValue(new NotFoundException());

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'someone-elses' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: 'Attachment someone-elses was not found.',
    });
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('refuses an object that is not ready', async () => {
    objects.getById.mockResolvedValue({
      ...imageObject('obj-1'),
      status: 'processing',
    });

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: expect.stringContaining('is not ready'),
    });
  });

  it('refuses an oversize image, stopping the download early', async () => {
    objects.getById.mockResolvedValue(imageObject('obj-1'));
    // Two chunks: the limit is passed on the first, so the second must never
    // be pulled.
    const second = jest.fn();
    storage.download.mockResolvedValue(
      Readable.from(
        (function* () {
          yield Buffer.alloc(2048);
          second();
          yield Buffer.alloc(2048);
        })(),
      ),
    );

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: expect.stringContaining('exceeds 1024 bytes'),
    });
    expect(second).not.toHaveBeenCalled();
  });

  it('refuses an unsupported mime type', async () => {
    objects.getById.mockResolvedValue({
      id: 'obj-1',
      mimeType: 'text/plain',
      status: 'ready',
      metadata: null,
    });

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: expect.stringContaining('Unsupported attachment type'),
    });
  });

  it('expands a video into its sampled frames, in timestamp order', async () => {
    objects.getById.mockImplementation(async (id: string) => {
      if (id === 'video-1') {
        return {
          id,
          mimeType: 'video/mp4',
          status: 'ready',
          metadata: {
            _processing: {
              'video-frames': {
                // Deliberately out of order: the resolver sorts.
                frames: [
                  { objectId: 'frame-b', timestampMs: 2000 },
                  { objectId: 'frame-a', timestampMs: 1000 },
                ],
                durationMs: 3000,
              },
            },
          },
        };
      }
      return imageObject(id);
    });
    prisma.storageObject.findUnique.mockImplementation(async ({ where }: any) => ({
      storageKey: `key/${where.id}`,
    }));
    storage.download.mockImplementation(async (key: string) =>
      Readable.from([Buffer.from(key)]),
    );

    const parts = await build().resolve(USER_ID, [
      { storageObjectId: 'video-1' },
    ]);

    expect(parts).toHaveLength(2);
    expect((parts[0] as { base64: string }).base64).toBe(
      Buffer.from('key/frame-a').toString('base64'),
    );
    expect((parts[1] as { base64: string }).base64).toBe(
      Buffer.from('key/frame-b').toString('base64'),
    );
    // The ownership check runs for the video AND for each frame: a forged
    // _processing blob must not become a read primitive.
    expect(objects.getById).toHaveBeenCalledWith('frame-a', USER_ID);
    expect(objects.getById).toHaveBeenCalledWith('frame-b', USER_ID);
  });

  it('refuses a video that has not been processed yet', async () => {
    objects.getById.mockResolvedValue({
      id: 'video-1',
      mimeType: 'video/mp4',
      status: 'ready',
      metadata: { _processing: {} },
    });

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'video-1' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: 'Video video-1 has not been processed yet.',
    });
  });

  it('refuses more images than one call may carry', async () => {
    objects.getById.mockImplementation(async (id: string) => imageObject(id));

    await expect(
      build({ 'ai.attachments.maxImagesPerCall': 10 }).resolve(
        USER_ID,
        Array.from({ length: 11 }, (_v, i) => ({ storageObjectId: `obj-${i}` })),
      ),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: expect.stringContaining('Too many images'),
    });
  });

  it('turns a storage read failure into an attachment error', async () => {
    objects.getById.mockResolvedValue(imageObject('obj-1'));
    storage.download.mockRejectedValue(new Error('S3 is down'));

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: 'Attachment obj-1 could not be read from storage.',
    });
  });

  it('refuses to construct with an unimplemented attachment mode', async () => {
    // At BOOT, so a misconfiguration is a failed deploy rather than a broken
    // coaching reply.
    expect(() => build({ 'ai.attachments.mode': 'signed-url' })).toThrow(
      /Only "inline" is implemented/,
    );
  });
});
