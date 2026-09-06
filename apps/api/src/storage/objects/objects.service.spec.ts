import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Readable } from 'node:stream';

import { ObjectsService } from './objects.service';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../providers/storage-provider.interface';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../../test/mocks/storage-provider.mock';
import { OBJECT_UPLOADED_EVENT } from '../processing/events/object-uploaded.event';
import { StorageQuotaService } from './storage-quota.service';
import type { RequestUser } from '../../auth/interfaces/authenticated-user.interface';

describe('ObjectsService', () => {
  let service: ObjectsService;
  let mockPrisma: MockPrismaService;
  let mockStorageProvider: ReturnType<typeof createMockStorageProvider>;
  let mockConfig: jest.Mocked<ConfigService>;
  let configValues: Record<string, unknown>;
  let mockQuota: { assertCanStore: jest.Mock; usedBytes: jest.Mock };
  let mockEventEmitter: jest.Mocked<EventEmitter2>;

  const testUserId = 'user-123';
  const otherUserId = 'user-456';

  /** The owner, holding no admin override. */
  const testUser: RequestUser = {
    id: testUserId,
    email: 'owner@test.local',
    roles: ['viewer'],
    permissions: ['storage:read', 'storage:write'],
    isActive: true,
  };

  /** A non-owner holding every `storage:*_any` override (issue #71). */
  const adminUser: RequestUser = {
    id: 'user-admin',
    email: 'admin@test.local',
    roles: ['admin'],
    permissions: [
      'storage:read_any',
      'storage:write_any',
      'storage:delete_any',
    ],
    isActive: true,
  };

  /** A non-owner holding none of them. */
  const strangerUser: RequestUser = {
    id: otherUserId,
    email: 'stranger@test.local',
    roles: ['contributor'],
    permissions: ['storage:read', 'storage:write'],
    isActive: true,
  };

  const mockStorageObject = {
    id: 'obj-123',
    name: 'test-file.jpg',
    size: BigInt(1024000),
    mimeType: 'image/jpeg',
    storageKey: 'uploads/123456/uuid-123.jpg',
    storageProvider: 's3',
    bucket: 'test-bucket',
    status: 'ready',
    s3UploadId: null,
    uploadedById: testUserId,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockStorageProvider = createMockStorageProvider();
    // Key-aware from here on. A blanket mockReturnValue used to be harmless
    // because only `storage.partSize` was ever read; issue #71 makes the
    // service read the allowlist and the size limit too, and a number where an
    // array is expected is not a test failure anybody can read.
    configValues = {
      'storage.partSize': 10485760,
      'storage.maxFileSize': 524288000,
      'storage.allowedMimeTypes': ['image/*', 'video/*'],
      'storage.signedUrlExpiry': 3600,
    };
    mockConfig = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key in configValues ? configValues[key] : fallback,
      ),
    } as any;
    mockEventEmitter = {
      emit: jest.fn(),
    } as any;
    // Quota is exercised in storage-quota.service.spec.ts; here it is a
    // collaborator, and the tests that care assert it was CALLED.
    mockQuota = {
      assertCanStore: jest.fn().mockResolvedValue(undefined),
      usedBytes: jest.fn().mockResolvedValue(BigInt(0)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: StorageQuotaService, useValue: mockQuota },
      ],
    }).compile();

    service = module.get<ObjectsService>(ObjectsService);

    // `delete` looks for objects derived from the one being removed (#79).
    // Default to none so every pre-existing delete test keeps describing the
    // ordinary case; the derived-object tests override it.
    mockPrisma.storageObject.findMany.mockResolvedValue([] as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initUpload', () => {
    it('should create object record and return presigned URLs', async () => {
      const dto = {
        name: 'test.jpg',
        size: 52428800, // 50MB
        mimeType: 'image/jpeg',
      };

      mockStorageProvider.initMultipartUpload.mockResolvedValue({
        uploadId: 'upload-123',
        key: 'uploads/123/uuid.jpg',
      });
      mockStorageProvider.getBucket.mockReturnValue('test-bucket');
      mockPrisma.storageObject.create.mockResolvedValue({
        ...mockStorageObject,
        id: 'new-obj-id',
        name: dto.name,
        size: BigInt(dto.size),
        status: 'pending',
        s3UploadId: 'upload-123',
      } as any);

      const result = await service.initUpload(dto, testUserId);

      expect(result.objectId).toBe('new-obj-id');
      expect(result.uploadId).toBe('upload-123');
      expect(result.partSize).toBe(10485760);
      expect(result.totalParts).toBe(5); // 50MB / 10MB
      expect(result.presignedUrls).toHaveLength(5); // First batch up to 10
      expect(mockStorageProvider.initMultipartUpload).toHaveBeenCalled();
      expect(mockPrisma.storageObject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: dto.name,
            size: BigInt(dto.size),
            mimeType: dto.mimeType,
            status: 'pending',
            s3UploadId: 'upload-123',
            uploadedById: testUserId,
          }),
        }),
      );
    });

    it('should calculate correct part count for large files', async () => {
      const dto = {
        name: 'large.mp4',
        size: 104857600, // 100MB
        mimeType: 'video/mp4',
      };

      mockStorageProvider.initMultipartUpload.mockResolvedValue({
        uploadId: 'upload-456',
        key: 'uploads/456/uuid.mp4',
      });
      mockStorageProvider.getBucket.mockReturnValue('test-bucket');
      mockPrisma.storageObject.create.mockResolvedValue({
        ...mockStorageObject,
        id: 'new-obj-id',
      } as any);

      const result = await service.initUpload(dto, testUserId);

      expect(result.totalParts).toBe(10); // 100MB / 10MB
      expect(result.presignedUrls).toHaveLength(10); // First batch of 10
    });

    it('should generate unique storage key with timestamp and UUID', async () => {
      const dto = {
        name: 'test.jpg',
        size: 10485760,
        mimeType: 'image/jpeg',
      };

      mockStorageProvider.initMultipartUpload.mockResolvedValue({
        uploadId: 'upload-789',
        key: 'test-key',
      });
      mockStorageProvider.getBucket.mockReturnValue('test-bucket');
      mockPrisma.storageObject.create.mockResolvedValue({
        ...mockStorageObject,
      } as any);

      await service.initUpload(dto, testUserId);

      expect(mockPrisma.storageObject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storageKey: expect.stringMatching(/^uploads\/\d+\/[a-f0-9-]+\.jpg$/),
          }),
        }),
      );
    });

    it('should throw BadRequestException for files exceeding 10,000 parts', async () => {
      // The part-count guard is only reachable when MAX_FILE_SIZE is raised
      // far above its default — at 500 MiB the size check fires first, which
      // is the better error. Raise it here so this test exercises the guard it
      // is named after rather than silently testing issue #71's size limit.
      configValues['storage.maxFileSize'] = Number.MAX_SAFE_INTEGER;

      const dto = {
        name: 'huge.mp4',
        size: 524288000000, // 500GB
        mimeType: 'video/mp4',
      };

      // 500GB / 10MB = 50,000 parts > 10,000 limit

      await expect(service.initUpload(dto, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.initUpload(dto, testUserId)).rejects.toThrow(
        'File too large for multipart upload',
      );
    });

    it('should call storage provider initMultipartUpload', async () => {
      const dto = {
        name: 'test.jpg',
        size: 10485760,
        mimeType: 'image/jpeg',
      };

      mockStorageProvider.initMultipartUpload.mockResolvedValue({
        uploadId: 'upload-123',
        key: 'test-key',
      });
      mockStorageProvider.getBucket.mockReturnValue('test-bucket');
      mockPrisma.storageObject.create.mockResolvedValue({
        ...mockStorageObject,
      } as any);

      await service.initUpload(dto, testUserId);

      expect(mockStorageProvider.initMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^uploads\//),
        expect.objectContaining({
          mimeType: dto.mimeType,
        }),
      );
    });
  });

  describe('getUploadStatus', () => {
    it('should return upload status with chunk info', async () => {
      const chunks = [
        { partNumber: 1, size: BigInt(10485760), eTag: 'etag1' },
        { partNumber: 2, size: BigInt(10485760), eTag: 'etag2' },
        { partNumber: 3, size: BigInt(5242880), eTag: 'etag3' },
      ];

      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        status: 'pending',
        size: BigInt(26214400), // ~25MB - matches totalBytes expectation
        chunks,
      } as any);

      const result = await service.getUploadStatus(mockStorageObject.id, testUserId);

      expect(result.objectId).toBe(mockStorageObject.id);
      expect(result.status).toBe('pending');
      expect(result.uploadedParts).toEqual([1, 2, 3]);
      expect(result.totalParts).toBe(3);
      expect(result.uploadedBytes).toBe('26214400');
      expect(result.totalBytes).toBe('26214400'); // Updated to match mock size
    });

    it('should throw NotFoundException for non-existent object', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(null);

      await expect(
        service.getUploadStatus('non-existent', testUserId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getUploadStatus('non-existent', testUserId),
      ).rejects.toThrow('Upload not found');
    });

    it('should throw ForbiddenException for non-owner', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        uploadedById: otherUserId,
        chunks: [],
      } as any);

      await expect(
        service.getUploadStatus(mockStorageObject.id, testUserId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.getUploadStatus(mockStorageObject.id, testUserId),
      ).rejects.toThrow('You do not own this upload');
    });
  });

  describe('completeUpload', () => {
    it('should complete multipart upload and update status', async () => {
      const dto = {
        parts: [
          { partNumber: 1, eTag: 'etag1' },
          { partNumber: 2, eTag: 'etag2' },
        ],
      };

      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        status: 'pending',
        s3UploadId: 'upload-123',
        chunks: [],
      } as any);
      mockPrisma.storageObjectChunk.upsert.mockResolvedValue({} as any);
      mockStorageProvider.completeMultipartUpload.mockResolvedValue({
        key: mockStorageObject.storageKey,
        bucket: 'test-bucket',
        location: 's3://test-bucket/key',
        eTag: 'final-etag',
      });
      mockPrisma.storageObject.update.mockResolvedValue({
        ...mockStorageObject,
        status: 'processing',
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.completeUpload(
        mockStorageObject.id,
        dto,
        testUserId,
      );

      expect(result.status).toBe('processing');
      expect(mockStorageProvider.completeMultipartUpload).toHaveBeenCalledWith(
        mockStorageObject.storageKey,
        'upload-123',
        dto.parts,
      );
      expect(mockPrisma.storageObject.update).toHaveBeenCalledWith({
        where: { id: mockStorageObject.id },
        data: { status: 'processing' },
      });
    });

    it('should emit ObjectUploadedEvent', async () => {
      const dto = {
        parts: [{ partNumber: 1, eTag: 'etag1' }],
      };

      const updatedObject = {
        ...mockStorageObject,
        status: 'processing',
      };

      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        s3UploadId: 'upload-123',
        chunks: [],
      } as any);
      mockPrisma.storageObjectChunk.upsert.mockResolvedValue({} as any);
      mockStorageProvider.completeMultipartUpload.mockResolvedValue({
        key: 'key',
        bucket: 'bucket',
        location: 's3://bucket/key',
      });
      mockPrisma.storageObject.update.mockResolvedValue(updatedObject as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.completeUpload(mockStorageObject.id, dto, testUserId);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        OBJECT_UPLOADED_EVENT,
        expect.objectContaining({
          object: updatedObject,
        }),
      );
    });

    it('should create audit event', async () => {
      const dto = {
        parts: [{ partNumber: 1, eTag: 'etag1' }],
      };

      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        s3UploadId: 'upload-123',
        chunks: [],
      } as any);
      mockPrisma.storageObjectChunk.upsert.mockResolvedValue({} as any);
      mockStorageProvider.completeMultipartUpload.mockResolvedValue({
        key: 'key',
        bucket: 'bucket',
        location: 's3://bucket/key',
      });
      mockPrisma.storageObject.update.mockResolvedValue({
        ...mockStorageObject,
        status: 'processing',
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.completeUpload(mockStorageObject.id, dto, testUserId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: testUserId,
          action: 'storage:upload:complete',
          targetType: 'storage_object',
          targetId: mockStorageObject.id,
          meta: expect.objectContaining({
            partsCount: 1,
          }),
        }),
      });
    });

    it('should throw NotFoundException for non-existent object', async () => {
      const dto = {
        parts: [{ partNumber: 1, eTag: 'etag1' }],
      };

      mockPrisma.storageObject.findUnique.mockResolvedValue(null);

      await expect(
        service.completeUpload('non-existent', dto, testUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for non-owner', async () => {
      const dto = {
        parts: [{ partNumber: 1, eTag: 'etag1' }],
      };

      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        uploadedById: otherUserId,
        s3UploadId: 'upload-123',
        chunks: [],
      } as any);

      await expect(
        service.completeUpload(mockStorageObject.id, dto, testUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when uploadId is missing', async () => {
      const dto = {
        parts: [{ partNumber: 1, eTag: 'etag1' }],
      };

      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        s3UploadId: null,
        chunks: [],
      } as any);

      await expect(
        service.completeUpload(mockStorageObject.id, dto, testUserId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.completeUpload(mockStorageObject.id, dto, testUserId),
      ).rejects.toThrow('Upload ID not found');
    });
  });

  describe('abortUpload', () => {
    it('should abort upload and delete records', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        s3UploadId: 'upload-123',
      } as any);
      mockStorageProvider.abortMultipartUpload.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.abortUpload(mockStorageObject.id, testUserId);

      expect(mockStorageProvider.abortMultipartUpload).toHaveBeenCalledWith(
        mockStorageObject.storageKey,
        'upload-123',
      );
      expect(mockPrisma.storageObject.delete).toHaveBeenCalledWith({
        where: { id: mockStorageObject.id },
      });
    });

    it('should call storage provider abortMultipartUpload', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        s3UploadId: 'upload-123',
      } as any);
      mockStorageProvider.abortMultipartUpload.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.abortUpload(mockStorageObject.id, testUserId);

      expect(mockStorageProvider.abortMultipartUpload).toHaveBeenCalledWith(
        mockStorageObject.storageKey,
        'upload-123',
      );
    });

    it('should create audit event', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        s3UploadId: 'upload-123',
      } as any);
      mockStorageProvider.abortMultipartUpload.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.abortUpload(mockStorageObject.id, testUserId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: testUserId,
          action: 'storage:upload:abort',
          targetType: 'storage_object',
          targetId: mockStorageObject.id,
        }),
      });
    });

    it('should throw NotFoundException for non-existent object', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(null);

      await expect(
        service.abortUpload('non-existent', testUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for non-owner', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        uploadedById: otherUserId,
        s3UploadId: 'upload-123',
      } as any);

      await expect(
        service.abortUpload(mockStorageObject.id, testUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('simpleUpload', () => {
    it('should upload file and create record', async () => {
      const file = {
        filename: 'test.jpg',
        mimetype: 'image/jpeg',
        file: Readable.from(['test content']),
      };

      mockStorageProvider.upload.mockResolvedValue({
        key: 'uploads/123/uuid.jpg',
        bucket: 'test-bucket',
        location: 's3://test-bucket/uploads/123/uuid.jpg',
        eTag: 'etag123',
      });
      mockPrisma.storageObject.create.mockResolvedValue({
        ...mockStorageObject,
        name: file.filename,
        mimeType: file.mimetype,
        status: 'processing',
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.simpleUpload(file, testUserId);

      expect(result.name).toBe(file.filename);
      expect(result.mimeType).toBe(file.mimetype);
      expect(result.status).toBe('processing');
      expect(mockStorageProvider.upload).toHaveBeenCalled();
    });

    it('should emit ObjectUploadedEvent', async () => {
      const file = {
        filename: 'test.jpg',
        mimetype: 'image/jpeg',
        file: Readable.from(['test content']),
      };

      const createdObject = {
        ...mockStorageObject,
        status: 'processing',
      };

      mockStorageProvider.upload.mockResolvedValue({
        key: 'key',
        bucket: 'bucket',
        location: 's3://bucket/key',
      });
      mockPrisma.storageObject.create.mockResolvedValue(createdObject as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.simpleUpload(file, testUserId);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        OBJECT_UPLOADED_EVENT,
        expect.objectContaining({
          object: createdObject,
        }),
      );
    });

    it('should create audit event', async () => {
      const file = {
        filename: 'test.jpg',
        mimetype: 'image/jpeg',
        file: Readable.from(['test content']),
      };

      mockStorageProvider.upload.mockResolvedValue({
        key: 'key',
        bucket: 'bucket',
        location: 's3://bucket/key',
      });
      mockPrisma.storageObject.create.mockResolvedValue({
        ...mockStorageObject,
        id: 'new-id',
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.simpleUpload(file, testUserId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: testUserId,
          action: 'storage:upload:complete',
          targetType: 'storage_object',
          targetId: 'new-id',
          meta: expect.objectContaining({
            uploadType: 'simple',
          }),
        }),
      });
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      const query = {
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
      };

      const mockObjects = [
        { ...mockStorageObject, id: 'obj-1' },
        { ...mockStorageObject, id: 'obj-2' },
      ];

      mockPrisma.storageObject.findMany.mockResolvedValue(mockObjects as any);
      mockPrisma.storageObject.count.mockResolvedValue(2);

      const result = await service.list(query, testUserId);

      expect(result.items).toHaveLength(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(result.meta.totalItems).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should filter by status', async () => {
      const query = {
        page: 1,
        pageSize: 20,
        status: 'ready' as const,
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([mockStorageObject] as any);
      mockPrisma.storageObject.count.mockResolvedValue(1);

      await service.list(query, testUserId);

      expect(mockPrisma.storageObject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ready',
          }),
        }),
      );
    });

    it('should sort by specified field', async () => {
      const query = {
        page: 1,
        pageSize: 20,
        sortBy: 'name' as const,
        sortOrder: 'asc' as const,
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([]);
      mockPrisma.storageObject.count.mockResolvedValue(0);

      await service.list(query, testUserId);

      expect(mockPrisma.storageObject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });
  });

  describe('getById', () => {
    it('should return object metadata', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(mockStorageObject as any);

      const result = await service.getById(mockStorageObject.id, testUser);

      expect(result.id).toBe(mockStorageObject.id);
      expect(result.name).toBe(mockStorageObject.name);
    });

    it('should throw NotFoundException for non-existent object', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(null);

      await expect(service.getById('non-existent', testUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for non-owner', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        uploadedById: otherUserId,
      } as any);

      await expect(
        service.getById(mockStorageObject.id, testUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getDownloadUrl', () => {
    it('should return signed URL for ready objects', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        status: 'ready',
      } as any);
      mockStorageProvider.getSignedDownloadUrl.mockResolvedValue(
        'https://signed-url.com/download',
      );

      const result = await service.getDownloadUrl(mockStorageObject.id, testUser);

      expect(result.url).toBe('https://signed-url.com/download');
      expect(result.expiresIn).toBe(3600);
      expect(mockStorageProvider.getSignedDownloadUrl).toHaveBeenCalledWith(
        mockStorageObject.storageKey,
        { expiresIn: 3600 },
      );
    });

    it('should throw BadRequestException for non-ready objects', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        status: 'processing',
      } as any);

      await expect(
        service.getDownloadUrl(mockStorageObject.id, testUser),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getDownloadUrl(mockStorageObject.id, testUser),
      ).rejects.toThrow('Object is not ready for download');
    });
  });

  describe('delete', () => {
    it('should delete from storage and database', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(mockStorageObject as any);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.delete(mockStorageObject.id, testUser);

      expect(mockStorageProvider.delete).toHaveBeenCalledWith(
        mockStorageObject.storageKey,
      );
      expect(mockPrisma.storageObject.delete).toHaveBeenCalledWith({
        where: { id: mockStorageObject.id },
      });
    });

    it('should create audit event', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(mockStorageObject as any);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.delete(mockStorageObject.id, testUser);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: testUserId,
          action: 'storage:object:delete',
          targetType: 'storage_object',
          targetId: mockStorageObject.id,
        }),
      });
    });
  });

  describe('updateMetadata', () => {
    it('should merge metadata and update record', async () => {
      const existingMetadata = { key1: 'value1' };
      const newMetadata = { key2: 'value2' };

      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        metadata: existingMetadata,
      } as any);
      mockPrisma.storageObject.update.mockResolvedValue({
        ...mockStorageObject,
        metadata: { ...existingMetadata, ...newMetadata },
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.updateMetadata(
        mockStorageObject.id,
        { metadata: newMetadata },
        testUser,
      );

      expect(mockPrisma.storageObject.update).toHaveBeenCalledWith({
        where: { id: mockStorageObject.id },
        data: {
          metadata: { ...existingMetadata, ...newMetadata },
        },
      });
    });

    it('should create audit event', async () => {
      const newMetadata = { key: 'value' };

      mockPrisma.storageObject.findUnique.mockResolvedValue(mockStorageObject as any);
      mockPrisma.storageObject.update.mockResolvedValue({
        ...mockStorageObject,
        metadata: newMetadata,
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.updateMetadata(
        mockStorageObject.id,
        { metadata: newMetadata },
        testUser,
      );

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: testUserId,
          action: 'storage:object:metadata:update',
          targetType: 'storage_object',
          targetId: mockStorageObject.id,
        }),
      });
    });
  });
  // ---------------------------------------------------------------------------
  // Issue #71 — the allowlist, the size limit and the admin overrides
  // ---------------------------------------------------------------------------
  describe('upload limits (issue #71)', () => {
    it('rejects a disallowed type from initUpload with the exact message', async () => {
      await expect(
        service.initUpload(
          { name: 'x.txt', size: 10, mimeType: 'text/plain' },
          testUserId,
        ),
      ).rejects.toThrow(
        'File type "text/plain" is not allowed. Allowed: image/*, video/*',
      );

      // Nothing reached the provider: a refused upload must not leave an open
      // multipart session on the bucket.
      expect(mockStorageProvider.initMultipartUpload).not.toHaveBeenCalled();
      expect(mockPrisma.storageObject.create).not.toHaveBeenCalled();
    });

    it('rejects one byte over the limit and accepts exactly the limit', async () => {
      configValues['storage.maxFileSize'] = 1000;

      await expect(
        service.initUpload(
          { name: 'x.jpg', size: 1001, mimeType: 'image/jpeg' },
          testUserId,
        ),
      ).rejects.toThrow('File is 1001 bytes; the limit is 1000 bytes (1000 B)');

      mockStorageProvider.initMultipartUpload.mockResolvedValue({
        uploadId: 'upload-1',
        key: 'k',
      });
      mockStorageProvider.getBucket.mockReturnValue('test-bucket');
      mockPrisma.storageObject.create.mockResolvedValue({
        ...mockStorageObject,
      } as any);

      await expect(
        service.initUpload(
          { name: 'x.jpg', size: 1000, mimeType: 'image/jpeg' },
          testUserId,
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a disallowed type on the simple path before any byte is uploaded', async () => {
      await expect(
        service.simpleUpload(
          {
            filename: 'note.txt',
            mimetype: 'text/plain',
            file: Readable.from(['hello']),
          },
          testUserId,
        ),
      ).rejects.toThrow('is not allowed');

      expect(mockStorageProvider.upload).not.toHaveBeenCalled();
    });

    it('persists the counted bytes rather than the zero it used to write', async () => {
      // `size: 0` was written "to be updated by post-processing" and nothing
      // ever updated it, so every simple upload reported zero bytes forever.
      mockStorageProvider.upload.mockImplementation(async (_key, stream) => {
        for await (const chunk of stream as Readable) void chunk;
        return {
          key: 'k',
          bucket: 'test-bucket',
          location: 's3://test-bucket/k',
          eTag: 'e',
        };
      });
      mockPrisma.storageObject.create.mockResolvedValue(mockStorageObject as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.simpleUpload(
        {
          filename: 'photo.jpg',
          mimetype: 'image/jpeg',
          file: Readable.from([Buffer.alloc(1234)]),
        },
        testUserId,
      );

      expect(mockPrisma.storageObject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ size: BigInt(1234) }),
        }),
      );
    });

    it('aborts an oversize stream, deletes the partial key and answers 400', async () => {
      configValues['storage.maxFileSize'] = 100;

      mockStorageProvider.upload.mockImplementation(async (_key, stream) => {
        // Consume the counter so it can reach its limit, then surface the
        // error the way the AWS SDK does.
        for await (const chunk of stream as Readable) void chunk;
        return { key: 'k', bucket: 'b', location: 'l', eTag: 'e' };
      });
      mockStorageProvider.delete.mockResolvedValue(undefined);

      await expect(
        service.simpleUpload(
          {
            filename: 'big.jpg',
            mimetype: 'image/jpeg',
            file: Readable.from([Buffer.alloc(500)]),
          },
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockStorageProvider.delete).toHaveBeenCalled();
      expect(mockPrisma.storageObject.create).not.toHaveBeenCalled();
    });
  });

  describe('admin overrides (issue #71)', () => {
    const foreignObject = { ...mockStorageObject, uploadedById: 'someone-else' };

    beforeEach(() => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(foreignObject as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    it('lets storage:read_any read another user\'s object', async () => {
      await expect(
        service.getById(mockStorageObject.id, adminUser),
      ).resolves.toMatchObject({ id: mockStorageObject.id });
    });

    it('still refuses a non-owner without the permission', async () => {
      await expect(
        service.getById(mockStorageObject.id, strangerUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets storage:delete_any delete, and records that it was an admin act', async () => {
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await service.delete(mockStorageObject.id, adminUser);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: adminUser.id,
          action: 'storage:object:delete',
          meta: expect.objectContaining({ actedAsAdmin: true }),
        }),
      });
    });

    it('lets storage:write_any update metadata, and marks the audit row', async () => {
      mockPrisma.storageObject.update.mockResolvedValue(foreignObject as any);

      await service.updateMetadata(
        mockStorageObject.id,
        { metadata: { reviewed: true } },
        adminUser,
      );

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'storage:object:metadata:update',
          meta: expect.objectContaining({ actedAsAdmin: true }),
        }),
      });
    });

    it('does not mark the owner\'s own delete as an admin act', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(
        mockStorageObject as any,
      );
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await service.delete(mockStorageObject.id, testUser);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          meta: expect.not.objectContaining({ actedAsAdmin: true }),
        }),
      });
    });

    it('never grants the override to getOwnedById, which the AI path uses', async () => {
      // An admin resolving their own attachments must not be able to inline
      // another user's photo into a model call.
      await expect(
        service.getOwnedById(mockStorageObject.id, adminUser.id),
      ).rejects.toThrow(ForbiddenException);
    });
  });
  describe('derived objects (issue #79)', () => {
    it('deletes every frame of a video before the video itself', async () => {
      // Frames are ordinary StorageObject rows with no foreign key back to
      // their parent, so nothing cascades them. Leaving them behind leaks
      // bytes the user believes they deleted, and leaves images of a video the
      // product says is gone.
      mockPrisma.storageObject.findUnique.mockResolvedValue(
        mockStorageObject as any,
      );
      mockPrisma.storageObject.findMany.mockResolvedValue([
        { id: 'frame-1', storageKey: 'derived/obj-123/frame-0.jpg' },
        { id: 'frame-2', storageKey: 'derived/obj-123/frame-1.jpg' },
      ] as any);
      mockPrisma.storageObject.deleteMany.mockResolvedValue({ count: 2 } as any);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.delete(mockStorageObject.id, testUser);

      expect(mockPrisma.storageObject.findMany).toHaveBeenCalledWith({
        where: { metadata: { path: ['derivedFrom'], equals: mockStorageObject.id } },
        select: { id: true, storageKey: true },
      });
      expect(mockPrisma.storageObject.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['frame-1', 'frame-2'] } },
      });
      // Two frames plus the parent.
      expect(mockStorageProvider.delete).toHaveBeenCalledTimes(3);
      expect(mockStorageProvider.delete).toHaveBeenCalledWith(
        'derived/obj-123/frame-0.jpg',
      );
      expect(mockStorageProvider.delete).toHaveBeenCalledWith(
        mockStorageObject.storageKey,
      );
    });

    it('deletes an object with no derived children exactly as before', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(
        mockStorageObject as any,
      );
      mockPrisma.storageObject.findMany.mockResolvedValue([] as any);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.delete(mockStorageObject.id, testUser);

      expect(mockPrisma.storageObject.deleteMany).not.toHaveBeenCalled();
      expect(mockStorageProvider.delete).toHaveBeenCalledTimes(1);
    });
  });
  describe('quota (issue #87)', () => {
    it('checks the quota before the provider is touched on initUpload', async () => {
      // A rejected upload must not leave an open multipart session behind.
      mockQuota.assertCanStore.mockRejectedValue(
        new PayloadTooLargeException('Storage quota exceeded: 1 of 1 bytes used'),
      );

      await expect(
        service.initUpload(
          { name: 'x.jpg', size: 100, mimeType: 'image/jpeg' },
          testUserId,
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);

      expect(mockQuota.assertCanStore).toHaveBeenCalledWith(testUserId, 100);
      expect(mockStorageProvider.initMultipartUpload).not.toHaveBeenCalled();
    });

    it('re-checks the simple path with the counted bytes and deletes the key', async () => {
      // The length was never declared, so the only honest ordering is: write
      // the bytes, measure them, then refuse and clean up.
      mockStorageProvider.upload.mockImplementation(async (_key, stream) => {
        for await (const chunk of stream as Readable) void chunk;
        return { key: 'k', bucket: 'b', location: 'l', eTag: 'e' };
      });
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockQuota.assertCanStore
        .mockResolvedValueOnce(undefined) // the up-front check, nothing declared
        .mockRejectedValueOnce(
          new PayloadTooLargeException('Storage quota exceeded: 0 of 10 bytes used'),
        );

      await expect(
        service.simpleUpload(
          {
            filename: 'photo.jpg',
            mimetype: 'image/jpeg',
            file: Readable.from([Buffer.alloc(50)]),
          },
          testUserId,
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);

      expect(mockQuota.assertCanStore).toHaveBeenNthCalledWith(2, testUserId, 50);
      expect(mockStorageProvider.delete).toHaveBeenCalled();
      expect(mockPrisma.storageObject.create).not.toHaveBeenCalled();
    });
  });
  describe('getUploadUrls (issue #91)', () => {
    const inFlight = {
      ...mockStorageObject,
      status: 'pending',
      s3UploadId: 'upload-123',
    };

    it('signs exactly the requested range', async () => {
      // The init response carries only the first ten. Without this route a
      // file over 100 MiB at the default part size is a dead end: the client
      // has no way to get URLs for parts 11 onward.
      mockPrisma.storageObject.findUnique.mockResolvedValue(inFlight as any);
      mockStorageProvider.getSignedUploadUrl.mockImplementation(
        async (_key: string, _uploadId: string, partNumber: number) =>
          `https://signed/part-${partNumber}`,
      );

      const result = await service.getUploadUrls(
        mockStorageObject.id,
        testUserId,
        11,
        13,
      );

      expect(result.presignedUrls).toEqual([
        { partNumber: 11, url: 'https://signed/part-11' },
        { partNumber: 12, url: 'https://signed/part-12' },
        { partNumber: 13, url: 'https://signed/part-13' },
      ]);
    });

    it('refuses more than 50 at a time', async () => {
      // Each URL is an HMAC this process computes.
      mockPrisma.storageObject.findUnique.mockResolvedValue(inFlight as any);

      await expect(
        service.getUploadUrls(mockStorageObject.id, testUserId, 1, 51),
      ).rejects.toThrow('At most 50 part URLs');
    });

    it('refuses an inverted range', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(inFlight as any);

      await expect(
        service.getUploadUrls(mockStorageObject.id, testUserId, 10, 5),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stays owner-only, with no admin override', async () => {
      // An admin override on somebody else's half-finished upload is not a
      // thing anybody needs, and every other in-flight route agrees.
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...inFlight,
        uploadedById: 'somebody-else',
      } as any);

      await expect(
        service.getUploadUrls(mockStorageObject.id, testUserId, 1, 2),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
