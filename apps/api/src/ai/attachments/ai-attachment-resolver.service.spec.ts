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
  let objects: { getOwnedById: jest.Mock };
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
    objects = { getOwnedById: jest.fn() };
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
    expect(objects.getOwnedById).not.toHaveBeenCalled();
  });

  it('inlines an image with its real mime type and requested detail', async () => {
    objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));

    const parts = await build().resolve(USER_ID, [
      { storageObjectId: 'obj-1', detail: 'high' },
    ]);

    expect(objects.getOwnedById).toHaveBeenCalledWith('obj-1', USER_ID);
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
    objects.getOwnedById.mockRejectedValue(new NotFoundException());

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'someone-elses' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: 'Attachment someone-elses was not found.',
    });
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('refuses an object that is not ready', async () => {
    objects.getOwnedById.mockResolvedValue({
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
    objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));
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
    objects.getOwnedById.mockResolvedValue({
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
    objects.getOwnedById.mockImplementation(async (id: string) => {
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
    expect(objects.getOwnedById).toHaveBeenCalledWith('frame-a', USER_ID);
    expect(objects.getOwnedById).toHaveBeenCalledWith('frame-b', USER_ID);
  });

  it('refuses a video that has not been processed yet', async () => {
    objects.getOwnedById.mockResolvedValue({
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
    objects.getOwnedById.mockImplementation(async (id: string) => imageObject(id));

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
    objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));
    storage.download.mockRejectedValue(new Error('S3 is down'));

    await expect(
      build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]),
    ).rejects.toMatchObject({
      code: 'attachment',
      message: 'Attachment obj-1 could not be read from storage.',
    });
  });

  it('refuses to construct with an unknown attachment mode', async () => {
    // At BOOT, so a misconfiguration is a failed deploy rather than a broken
    // coaching reply. `signed-url` is implemented as of issue #87; a typo is
    // still fatal.
    expect(() => build({ 'ai.attachments.mode': 'signed-urls' })).toThrow(
      /Use "inline" or "signed-url"/,
    );
    expect(() => build({ 'ai.attachments.mode': 'signed-url' })).not.toThrow();
  });
  // ---------------------------------------------------------------------------
  // Issue #87 — the normalized variant, and signed-url mode
  // ---------------------------------------------------------------------------
  describe('variant preference', () => {
    const normalized = (variantId: string) => ({
      id: 'obj-1',
      mimeType: 'image/jpeg',
      status: 'ready',
      metadata: {
        _processing: { 'image-normalize': { aiVariantObjectId: variantId } },
      },
    });

    it('sends the normalized variant rather than the original', async () => {
      // The original carries the user's GPS coordinates and roughly fifty
      // times the tokens, for an image the model reads at 1024 px anyway.
      objects.getOwnedById.mockResolvedValue(normalized('variant-1'));
      prisma.storageObject.findUnique.mockImplementation(
        async ({ where }: any) =>
          where.id === 'variant-1'
            ? { status: 'ready', mimeType: 'image/jpeg', storageKey: 'derived/obj-1/ai.jpg', size: BigInt(100) }
            : { status: 'ready', mimeType: 'image/jpeg', storageKey: 'uploads/1/photo.jpg', size: BigInt(999999) },
      );

      await build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]);

      expect(storage.download).toHaveBeenCalledWith('derived/obj-1/ai.jpg');
    });

    it('falls back to the original when the variant is not ready yet', async () => {
      objects.getOwnedById.mockResolvedValue(normalized('variant-1'));
      prisma.storageObject.findUnique.mockImplementation(
        async ({ where }: any) =>
          where.id === 'variant-1'
            ? { status: 'processing', mimeType: 'image/jpeg' }
            : { storageKey: 'uploads/1/photo.jpg', size: BigInt(10) },
      );

      await build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]);

      expect(storage.download).toHaveBeenCalledWith('uploads/1/photo.jpg');
    });

    it('refuses an oversize original that has no variant', async () => {
      // Without this the provider refuses it anyway — after the upload
      // bandwidth is spent, with a message about base64 length nobody can act
      // on.
      objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));
      prisma.storageObject.findUnique.mockResolvedValue({
        storageKey: 'uploads/1/photo.jpg',
        size: BigInt(999999),
      });

      await expect(
        build().resolve(USER_ID, [{ storageObjectId: 'obj-1' }]),
      ).rejects.toMatchObject({
        code: 'attachment',
        message: expect.stringContaining('no normalized variant'),
      });
      expect(storage.download).not.toHaveBeenCalled();
    });

    it('accepts an original under the cap with no variant', async () => {
      objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));
      prisma.storageObject.findUnique.mockResolvedValue({
        storageKey: 'uploads/1/photo.jpg',
        size: BigInt(10),
      });

      const parts = await build().resolve(USER_ID, [
        { storageObjectId: 'obj-1' },
      ]);

      expect(parts).toHaveLength(1);
    });
  });

  describe('signed-url mode', () => {
    const signedMode = { 'ai.attachments.mode': 'signed-url' };

    it('emits an image_url part and never reads the bytes', async () => {
      // The whole point of this mode is that the bytes do not pass through
      // this process (PRD §118).
      objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));
      prisma.storageObject.findUnique.mockResolvedValue({
        storageKey: 'uploads/1/photo.jpg',
        size: BigInt(10),
      });
      storage.getSignedDownloadUrl.mockResolvedValue(
        'https://minio.example/uploads/1/photo.jpg?X-Amz-Signature=abc',
      );

      const parts = await build(signedMode).resolve(USER_ID, [
        { storageObjectId: 'obj-1', detail: 'low' },
      ]);

      expect(parts).toEqual([
        {
          type: 'image_url',
          url: 'https://minio.example/uploads/1/photo.jpg?X-Amz-Signature=abc',
          detail: 'low',
        },
      ]);
      expect(storage.download).not.toHaveBeenCalled();
    });

    it('signs with the configured short TTL', async () => {
      objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));
      prisma.storageObject.findUnique.mockResolvedValue({
        storageKey: 'uploads/1/photo.jpg',
        size: BigInt(10),
      });

      await build({
        ...signedMode,
        'ai.attachments.signedUrlTtlSeconds': 120,
      }).resolve(USER_ID, [{ storageObjectId: 'obj-1' }]);

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
        'uploads/1/photo.jpg',
        { expiresIn: 120 },
      );
    });

    it('does not apply the inline size cap, which is about a request body', async () => {
      // A 25 MiB original is fine when the provider fetches it itself; the cap
      // exists because base64 in a request body is the expensive part.
      objects.getOwnedById.mockResolvedValue(imageObject('obj-1'));
      prisma.storageObject.findUnique.mockResolvedValue({
        storageKey: 'uploads/1/photo.jpg',
        size: BigInt(999999),
      });

      await expect(
        build(signedMode).resolve(USER_ID, [{ storageObjectId: 'obj-1' }]),
      ).resolves.toHaveLength(1);
    });
  });
});
