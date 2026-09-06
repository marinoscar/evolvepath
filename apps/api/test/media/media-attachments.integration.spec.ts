import request from 'supertest';

import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockTestUser, authHeader } from '../helpers/auth-mock.helper';
import { STORAGE_PROVIDER } from '../../src/storage/providers/storage-provider.interface';
import { createMockStorageProvider } from '../mocks/storage-provider.mock';

// =============================================================================
// /media/attachments — the private, purpose-typed view of an upload (#83)
// =============================================================================
//
// The rule under test throughout: **404, never 403**, for both a missing id and
// a foreign one. `ObjectsService` answers 403 for a foreign RAW object, and the
// asymmetry is deliberate — the storage API is generic and permission-based, an
// attachment is a private product resource, and distinguishing "yours" from
// "exists" is an enumeration primitive.
// =============================================================================

const OBJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-4466554400aa';
const FOREIGN_ATTACHMENT_ID = '550e8400-e29b-41d4-a716-4466554400bb';

describe('Media Attachments Integration', () => {
  let context: TestContext;
  let mockStorageProvider: ReturnType<typeof createMockStorageProvider>;

  const storageObject = (overrides: Record<string, any> = {}) => ({
    id: OBJECT_ID,
    name: 'clip.mp4',
    size: BigInt(2048),
    mimeType: 'video/mp4',
    storageKey: 'uploads/1/clip.mp4',
    storageProvider: 's3',
    bucket: 'test-bucket',
    status: 'ready',
    s3UploadId: null,
    metadata: null,
    uploadedById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const attachment = (overrides: Record<string, any> = {}) => ({
    id: ATTACHMENT_ID,
    userId: 'user-1',
    storageObjectId: OBJECT_ID,
    kind: 'VIDEO',
    purpose: 'WORKOUT_FORM',
    targetType: null,
    targetId: null,
    aiSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    storageObject: storageObject(),
    ...overrides,
  });

  beforeAll(async () => {
    mockStorageProvider = createMockStorageProvider();
    context = await createTestApp({ useMockDatabase: true });

    const provider = context.module.get(STORAGE_PROVIDER, { strict: false });
    if (provider) Object.assign(provider, mockStorageProvider);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    jest.clearAllMocks();
    context.prismaMock.auditEvent.create.mockResolvedValue({});
  });

  describe('POST /api/media/attachments', () => {
    it('creates an attachment for the caller’s own upload', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.storageObject.findUnique.mockResolvedValue(
        storageObject({ uploadedById: user.id }),
      );
      context.prismaMock.mediaAttachment.create.mockResolvedValue(
        attachment({ userId: user.id }),
      );

      const response = await request(context.app.getHttpServer())
        .post('/api/media/attachments')
        .set(authHeader(user.accessToken))
        .send({ storageObjectId: OBJECT_ID, purpose: 'WORKOUT_FORM' })
        .expect(201);

      expect(response.body.data).toMatchObject({
        kind: 'VIDEO',
        purpose: 'WORKOUT_FORM',
        processingStatus: 'ready',
      });
    });

    it('refuses a targetId with no targetType', async () => {
      // Half a target is not a target: `targetId` alone is unqueryable,
      // because the index is on the pair.
      const user = await createMockTestUser(context);

      await request(context.app.getHttpServer())
        .post('/api/media/attachments')
        .set(authHeader(user.accessToken))
        .send({
          storageObjectId: OBJECT_ID,
          purpose: 'GENERAL',
          targetId: '550e8400-e29b-41d4-a716-4466554400cc',
        })
        .expect(400);
    });

    it('refuses an unknown target type', async () => {
      const user = await createMockTestUser(context);

      await request(context.app.getHttpServer())
        .post('/api/media/attachments')
        .set(authHeader(user.accessToken))
        .send({
          storageObjectId: OBJECT_ID,
          purpose: 'GENERAL',
          targetType: 'grocery_list',
          targetId: '550e8400-e29b-41d4-a716-4466554400cc',
        })
        .expect(400);
    });

    it('answers 404 for another user’s storage object', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.storageObject.findUnique.mockResolvedValue(
        storageObject({ uploadedById: 'somebody-else' }),
      );

      await request(context.app.getHttpServer())
        .post('/api/media/attachments')
        .set(authHeader(user.accessToken))
        .send({ storageObjectId: OBJECT_ID, purpose: 'GENERAL' })
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(context.app.getHttpServer())
        .post('/api/media/attachments')
        .send({ storageObjectId: OBJECT_ID, purpose: 'GENERAL' })
        .expect(401);
    });
  });

  describe('GET /api/media/attachments', () => {
    it('returns only the caller’s rows, filtered by target', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findMany.mockResolvedValue([
        attachment({ userId: user.id }),
      ]);
      context.prismaMock.mediaAttachment.count.mockResolvedValue(1);

      const response = await request(context.app.getHttpServer())
        .get(
          '/api/media/attachments?targetType=workout_session&targetId=550e8400-e29b-41d4-a716-4466554400cc',
        )
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.meta.totalItems).toBe(1);
      expect(
        context.prismaMock.mediaAttachment.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: user.id }),
        }),
      );
    });
  });

  describe('GET /api/media/attachments/:id', () => {
    it('answers 404 for a foreign attachment with a body that hints at nothing', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
        attachment({ id: FOREIGN_ATTACHMENT_ID, userId: 'somebody-else' }),
      );

      const response = await request(context.app.getHttpServer())
        .get(`/api/media/attachments/${FOREIGN_ATTACHMENT_ID}`)
        .set(authHeader(user.accessToken))
        .expect(404);

      // The same message a genuinely missing id produces. Anything that
      // distinguished them would answer "does this id exist?" for free.
      expect(response.body.message).toBe('Media attachment not found');
      expect(JSON.stringify(response.body)).not.toContain('somebody-else');
    });

    it('answers the same 404 for an id that never existed', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(null);

      const response = await request(context.app.getHttpServer())
        .get(`/api/media/attachments/${FOREIGN_ATTACHMENT_ID}`)
        .set(authHeader(user.accessToken))
        .expect(404);

      expect(response.body.message).toBe('Media attachment not found');
    });

    it('reports frame count once the pipeline has finished', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
        attachment({
          userId: user.id,
          storageObject: storageObject({
            metadata: {
              _processing: {
                'video-frames': {
                  frames: [{ objectId: 'f-0', timestampMs: 250 }],
                  durationMs: 2000,
                  width: 320,
                  height: 240,
                  frameCount: 4,
                },
              },
            },
          }),
        }),
      );

      const response = await request(context.app.getHttpServer())
        .get(`/api/media/attachments/${ATTACHMENT_ID}`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data.media.frameCount).toBe(4);
      expect(response.body.data.media.durationMs).toBe(2000);
    });
  });

  describe('DELETE /api/media/attachments/:id', () => {
    it('deletes the attachment and its storage object', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
        attachment({ userId: user.id }),
      );
      context.prismaMock.mediaAttachment.delete.mockResolvedValue({});
      // ObjectsService.delete's own path: ownership, derived children, bytes.
      context.prismaMock.storageObject.findUnique.mockResolvedValue(
        storageObject({ uploadedById: user.id }),
      );
      context.prismaMock.storageObject.findMany.mockResolvedValue([]);
      context.prismaMock.storageObject.delete.mockResolvedValue({});
      mockStorageProvider.delete.mockResolvedValue(undefined);

      await request(context.app.getHttpServer())
        .delete(`/api/media/attachments/${ATTACHMENT_ID}`)
        .set(authHeader(user.accessToken))
        .expect(204);

      expect(context.prismaMock.storageObject.delete).toHaveBeenCalled();
    });

    it('answers 404 for a foreign attachment', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
        attachment({ userId: 'somebody-else' }),
      );

      await request(context.app.getHttpServer())
        .delete(`/api/media/attachments/${ATTACHMENT_ID}`)
        .set(authHeader(user.accessToken))
        .expect(404);

      expect(context.prismaMock.storageObject.delete).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/media/attachments/:id/preview', () => {
    it('refuses a preview of media that is still processing', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
        attachment({
          userId: user.id,
          storageObject: storageObject({ status: 'processing' }),
        }),
      );

      await request(context.app.getHttpServer())
        .get(`/api/media/attachments/${ATTACHMENT_ID}/preview`)
        .set(authHeader(user.accessToken))
        .expect(400);
    });

    it('signs the frame’s key, not the parent’s', async () => {
      const user = await createMockTestUser(context);
      context.prismaMock.mediaAttachment.findUnique.mockResolvedValue(
        attachment({
          userId: user.id,
          storageObject: storageObject({
            metadata: {
              _processing: {
                'video-frames': {
                  frames: [{ objectId: 'f-0', timestampMs: 250 }],
                },
              },
            },
          }),
        }),
      );
      context.prismaMock.storageObject.findUnique.mockResolvedValue({
        storageKey: 'derived/obj-1/frame-0.jpg',
      });
      mockStorageProvider.getSignedDownloadUrl.mockResolvedValue(
        'https://signed/frame-0',
      );

      const response = await request(context.app.getHttpServer())
        .get(`/api/media/attachments/${ATTACHMENT_ID}/preview?variant=frame`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data.variant).toBe('frame');
      expect(mockStorageProvider.getSignedDownloadUrl).toHaveBeenCalledWith(
        'derived/obj-1/frame-0.jpg',
        expect.anything(),
      );
    });
  });
});
