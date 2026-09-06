import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ObjectsService } from '../storage/objects/objects.service';
import { createMockPrismaService } from '../../test/mocks/prisma.mock';
import { MediaAttachmentsService } from './media-attachments.service';
import type { RequestUser } from '../auth/interfaces/authenticated-user.interface';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

const requestUser: RequestUser = {
  id: USER_ID,
  email: 'owner@test.local',
  roles: ['viewer'],
  permissions: [],
  isActive: true,
};

function storageObject(overrides: Record<string, any> = {}) {
  return {
    id: 'obj-1',
    name: 'clip.mp4',
    size: BigInt(2048),
    mimeType: 'video/mp4',
    storageKey: 'uploads/1/clip.mp4',
    storageProvider: 's3',
    bucket: 'b',
    status: 'ready',
    s3UploadId: null,
    metadata: null,
    uploadedById: USER_ID,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function attachment(overrides: Record<string, any> = {}) {
  return {
    id: 'att-1',
    userId: USER_ID,
    storageObjectId: 'obj-1',
    kind: 'VIDEO',
    purpose: 'WORKOUT_FORM',
    targetType: null,
    targetId: null,
    aiSummary: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    storageObject: storageObject(),
    ...overrides,
  };
}

describe('MediaAttachmentsService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let objects: { delete: jest.Mock; getSignedUrlForKey: jest.Mock };
  let service: MediaAttachmentsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    objects = {
      delete: jest.fn().mockResolvedValue(undefined),
      getSignedUrlForKey: jest.fn().mockResolvedValue('https://signed/url'),
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'storage.signedUrlExpiry' ? 3600 : fallback,
      ),
    } as unknown as ConfigService;

    (prisma.auditEvent.create as jest.Mock).mockResolvedValue({});

    service = new MediaAttachmentsService(
      prisma as unknown as PrismaService,
      objects as unknown as ObjectsService,
      config,
    );
  });

  describe('create', () => {
    it('derives PHOTO from an image and VIDEO from a video', async () => {
      // `kind` is never sent by a client: it is a fact about the bytes, and a
      // client that could claim otherwise would select the wrong prompt.
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(
        storageObject({ mimeType: 'image/jpeg' }),
      );
      (prisma.mediaAttachment.create as jest.Mock).mockImplementation(
        async ({ data }: any) => attachment({ ...data, storageObject: storageObject({ mimeType: 'image/jpeg' }) }),
      );

      const result = await service.create(
        { storageObjectId: 'obj-1', purpose: 'MEAL' },
        USER_ID,
      );

      expect(result.kind).toBe('PHOTO');
    });

    it('answers 404 for another user’s storage object', async () => {
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(
        storageObject({ uploadedById: OTHER_USER_ID }),
      );

      await expect(
        service.create(
          { storageObjectId: 'obj-1', purpose: 'GENERAL' },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.mediaAttachment.create).not.toHaveBeenCalled();
    });

    it('answers 404 for a storage object that does not exist', async () => {
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create({ storageObjectId: 'obj-1', purpose: 'GENERAL' }, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a non-media object', async () => {
      // Only reachable for rows that predate the storage allowlist (#71), but
      // this API decides what an ATTACHMENT is, not what an upload is.
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(
        storageObject({ mimeType: 'application/pdf' }),
      );

      await expect(
        service.create({ storageObjectId: 'obj-1', purpose: 'GENERAL' }, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an object whose processing failed', async () => {
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(
        storageObject({ status: 'failed' }),
      );

      await expect(
        service.create({ storageObjectId: 'obj-1', purpose: 'GENERAL' }, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an object still processing', async () => {
      // Attaching before the frames exist is the normal case — the picker
      // attaches the moment the upload completes and then polls.
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(
        storageObject({ status: 'processing' }),
      );
      (prisma.mediaAttachment.create as jest.Mock).mockResolvedValue(
        attachment({ storageObject: storageObject({ status: 'processing' }) }),
      );

      const result = await service.create(
        { storageObjectId: 'obj-1', purpose: 'WORKOUT_FORM' },
        USER_ID,
      );

      expect(result.processingStatus).toBe('processing');
    });

    it('turns the unique violation into a 409', async () => {
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(
        storageObject(),
      );
      (prisma.mediaAttachment.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '7',
        }),
      );

      await expect(
        service.create({ storageObjectId: 'obj-1', purpose: 'GENERAL' }, USER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes a media:attach audit row', async () => {
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue(
        storageObject(),
      );
      (prisma.mediaAttachment.create as jest.Mock).mockResolvedValue(
        attachment({ targetType: 'workout_session', targetId: 'sess-1' }),
      );

      await service.create(
        {
          storageObjectId: 'obj-1',
          purpose: 'WORKOUT_FORM',
          targetType: 'workout_session',
          targetId: 'sess-1',
        },
        USER_ID,
      );

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'media:attach',
          targetType: 'media_attachment',
          meta: expect.objectContaining({
            purpose: 'WORKOUT_FORM',
            targetType: 'workout_session',
          }),
        }),
      });
    });
  });

  describe('processing state derivation', () => {
    it.each([
      ['pending', 'processing'],
      ['uploading', 'processing'],
      ['processing', 'processing'],
      ['ready', 'ready'],
      ['failed', 'failed'],
    ])('maps storage status %s to %s', async (storage, expected) => {
      // Five storage statuses collapse to the three a client can act on. A
      // picker showing "pending" and "uploading" as different things asks the
      // user to care about a distinction that changes nothing they can do.
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment({ storageObject: storageObject({ status: storage }) }),
      );

      const result = await service.getById('att-1', USER_ID);

      expect(result.processingStatus).toBe(expected);
    });

    it('surfaces the first processing error', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment({
          storageObject: storageObject({
            status: 'failed',
            metadata: {
              _processing: {
                'video-frames_error': 'video is 200s; the limit is 120s',
              },
            },
          }),
        }),
      );

      const result = await service.getById('att-1', USER_ID);

      expect(result.processingError).toContain('120s');
    });

    it('reads duration and frame count from the video-frames metadata', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment({
          storageObject: storageObject({
            metadata: {
              _processing: {
                'video-frames': {
                  frames: [{ objectId: 'f-0', timestampMs: 250 }],
                  durationMs: 2000,
                  width: 320,
                  height: 240,
                  frameCount: 1,
                },
              },
            },
          }),
        }),
      );

      const result = await service.getById('att-1', USER_ID);

      expect(result.media).toMatchObject({
        durationMs: 2000,
        frameCount: 1,
        width: 320,
        height: 240,
      });
    });

    it('reports nulls when nothing has processed yet', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment(),
      );

      const result = await service.getById('att-1', USER_ID);

      expect(result.media).toMatchObject({
        width: null,
        height: null,
        durationMs: null,
        frameCount: null,
      });
      expect(result.processingError).toBeNull();
    });
  });

  describe('ownership', () => {
    it('answers 404 — not 403 — for a foreign attachment', async () => {
      // The opposite of ObjectsService, on purpose: telling a caller that an
      // id they do not own EXISTS is an enumeration primitive, and an
      // attachment is a private product resource rather than a generic one.
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment({ userId: OTHER_USER_ID }),
      );

      await expect(service.getById('att-1', USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers the same 404 for one that does not exist', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getById('att-1', USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('removes the row, then the object, and audits in between', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment(),
      );
      (prisma.mediaAttachment.delete as jest.Mock).mockResolvedValue({});

      await service.delete('att-1', requestUser);

      expect(prisma.mediaAttachment.delete).toHaveBeenCalledWith({
        where: { id: 'att-1' },
      });
      // Through ObjectsService, so the video's sampled frames cascade with it.
      expect(objects.delete).toHaveBeenCalledWith('obj-1', requestUser);
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'media:delete' }),
      });
    });

    it('refuses a foreign attachment before touching storage', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment({ userId: OTHER_USER_ID }),
      );

      await expect(service.delete('att-1', requestUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(objects.delete).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    const withFrames = () =>
      attachment({
        storageObject: storageObject({
          metadata: {
            _processing: {
              'video-frames': {
                frames: [
                  { objectId: 'f-0', timestampMs: 250 },
                  { objectId: 'f-1', timestampMs: 750 },
                ],
              },
            },
          },
        }),
      });

    it('signs the parent key for the original', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment(),
      );

      const result = await service.getPreviewUrl('att-1', USER_ID, {
        variant: 'original',
        frameIndex: 0,
      });

      expect(objects.getSignedUrlForKey).toHaveBeenCalledWith(
        'uploads/1/clip.mp4',
        3600,
      );
      expect(result.variant).toBe('original');
    });

    it('signs the requested frame’s key, not the parent’s', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        withFrames(),
      );
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue({
        storageKey: 'derived/obj-1/frame-1.jpg',
      });

      const result = await service.getPreviewUrl('att-1', USER_ID, {
        variant: 'frame',
        frameIndex: 1,
      });

      expect(objects.getSignedUrlForKey).toHaveBeenCalledWith(
        'derived/obj-1/frame-1.jpg',
        3600,
      );
      expect(result.variant).toBe('frame');
    });

    it('refuses a frame index past the end', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        withFrames(),
      );

      await expect(
        service.getPreviewUrl('att-1', USER_ID, {
          variant: 'frame',
          frameIndex: 7,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('falls back to the original when no AI variant exists', async () => {
      // A caller asking for the AI variant wants a picture; `variant` in the
      // response says which one they got, so the fallback is visible rather
      // than silent.
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment(),
      );

      const result = await service.getPreviewUrl('att-1', USER_ID, {
        variant: 'ai',
        frameIndex: 0,
      });

      expect(result.variant).toBe('original');
    });

    it('uses the AI variant when one is ready', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment({
          storageObject: storageObject({
            mimeType: 'image/jpeg',
            metadata: {
              _processing: {
                'image-normalize': { aiVariantObjectId: 'variant-1' },
              },
            },
          }),
        }),
      );
      (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue({
        storageKey: 'derived/obj-1/ai.jpg',
        status: 'ready',
      });

      const result = await service.getPreviewUrl('att-1', USER_ID, {
        variant: 'ai',
        frameIndex: 0,
      });

      expect(result.variant).toBe('ai');
      expect(objects.getSignedUrlForKey).toHaveBeenCalledWith(
        'derived/obj-1/ai.jpg',
        3600,
      );
    });

    it('refuses a preview while the media is still processing', async () => {
      (prisma.mediaAttachment.findUnique as jest.Mock).mockResolvedValue(
        attachment({ storageObject: storageObject({ status: 'processing' }) }),
      );

      await expect(
        service.getPreviewUrl('att-1', USER_ID, {
          variant: 'original',
          frameIndex: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('scopes to the caller and filters by target', async () => {
      (prisma.mediaAttachment.findMany as jest.Mock).mockResolvedValue([
        attachment(),
      ]);
      (prisma.mediaAttachment.count as jest.Mock).mockResolvedValue(1);

      const result = await service.list(
        {
          targetType: 'workout_session',
          targetId: 'sess-1',
          page: 1,
          pageSize: 20,
        },
        USER_ID,
      );

      expect(prisma.mediaAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER_ID,
            targetType: 'workout_session',
            targetId: 'sess-1',
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.meta.totalItems).toBe(1);
    });
  });
});
