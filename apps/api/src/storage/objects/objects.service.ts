import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Inject } from '@nestjs/common';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { STORAGE_PROVIDER } from '../providers/storage-provider.interface';
import type { StorageProvider } from '../providers/storage-provider.interface';
import {
  InitUploadDto,
  InitUploadResponseDto,
} from './dto/init-upload.dto';
import {
  CompleteUploadDto,
} from './dto/complete-upload.dto';
import {
  ObjectResponseDto,
  UploadStatusResponseDto,
} from './dto/object-response.dto';
import {
  ObjectListQueryDto,
  ObjectListResponseDto,
} from './dto/object-list-query.dto';
import {
  UpdateMetadataDto,
} from './dto/update-metadata.dto';
import {
  DownloadUrlResponseDto,
} from './dto/download-url-response.dto';
import {
  OBJECT_UPLOADED_EVENT,
  ObjectUploadedEvent,
} from '../processing/events/object-uploaded.event';
import {
  disallowedMimeTypeMessage,
  fileTooLargeMessage,
  isMimeTypeAllowed,
} from './mime-allowlist';
import {
  ByteCounterStream,
  isByteLimitExceeded,
} from './byte-counter.stream';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import type { RequestUser } from '../../auth/interfaces/authenticated-user.interface';

/**
 * What the caller wants to do with an object. Each maps to one admin override
 * permission; the owner always passes regardless.
 */
export type ObjectAction = 'read' | 'write' | 'delete';

const ADMIN_OVERRIDE_PERMISSION: Record<ObjectAction, string> = {
  read: PERMISSIONS.STORAGE_READ_ANY,
  write: PERMISSIONS.STORAGE_WRITE_ANY,
  delete: PERMISSIONS.STORAGE_DELETE_ANY,
};

export interface MultipartFile {
  filename: string;
  mimetype: string;
  file: Readable;
}

@Injectable()
export class ObjectsService {
  private readonly logger = new Logger(ObjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Initialize a resumable multipart upload
   */
  async initUpload(
    dto: InitUploadDto,
    userId: string,
  ): Promise<InitUploadResponseDto> {
    const { name, size, mimeType } = dto;

    // Issue #71: the allowlist and the size limit have to be checked before a
    // multipart upload is initialized with the provider, or a rejected upload
    // still leaves an open multipart session on the bucket.
    this.assertUploadAllowed(mimeType, size, userId);

    // Get configuration
    const partSize = this.config.get<number>('storage.partSize', 10485760); // 10MB default
    const minPartSize = 5 * 1024 * 1024; // 5MB S3 minimum

    // Validate part size
    if (partSize < minPartSize) {
      throw new BadRequestException(
        `Part size must be at least ${minPartSize} bytes`,
      );
    }

    // Calculate total parts
    const totalParts = Math.ceil(size / partSize);

    if (totalParts > 10000) {
      throw new BadRequestException(
        'File too large for multipart upload (exceeds 10,000 parts)',
      );
    }

    // Generate storage key
    const timestamp = Date.now();
    const uuid = randomUUID();
    const extension = extname(name);
    const storageKey = `uploads/${timestamp}/${uuid}${extension}`;

    this.logger.log(`Initializing upload for ${name}, ${totalParts} parts`);

    // Initialize multipart upload with storage provider
    const { uploadId } = await this.storageProvider.initMultipartUpload(
      storageKey,
      { mimeType },
    );

    // Create StorageObject record
    const storageObject = await this.prisma.storageObject.create({
      data: {
        name,
        size: BigInt(size),
        mimeType,
        storageKey,
        storageProvider: 's3',
        bucket: this.storageProvider.getBucket(),
        status: 'pending',
        s3UploadId: uploadId,
        uploadedById: userId,
      },
    });

    // Generate presigned URLs for first batch (up to 10 parts)
    const urlBatchSize = Math.min(10, totalParts);
    const presignedUrls = await Promise.all(
      Array.from({ length: urlBatchSize }, (_, i) => i + 1).map(
        async (partNumber) => ({
          partNumber,
          url: await this.storageProvider.getSignedUploadUrl(
            storageKey,
            uploadId,
            partNumber,
          ),
        }),
      ),
    );

    this.logger.log(
      `Upload initialized: ${storageObject.id}, uploadId: ${uploadId}`,
    );

    return {
      objectId: storageObject.id,
      uploadId,
      partSize,
      totalParts,
      presignedUrls,
    };
  }

  /**
   * Get upload status and progress
   */
  async getUploadStatus(
    objectId: string,
    userId: string,
  ): Promise<UploadStatusResponseDto> {
    const storageObject = await this.prisma.storageObject.findUnique({
      where: { id: objectId },
      include: { chunks: true },
    });

    if (!storageObject) {
      throw new NotFoundException('Upload not found');
    }

    // Check ownership
    if (storageObject.uploadedById !== userId) {
      throw new ForbiddenException('You do not own this upload');
    }

    const uploadedParts = storageObject.chunks
      .map((chunk) => chunk.partNumber)
      .sort((a, b) => a - b);

    const uploadedBytes = storageObject.chunks.reduce(
      (sum, chunk) => sum + chunk.size,
      BigInt(0),
    );

    const partSize = this.config.get<number>('storage.partSize', 10485760);
    const totalParts = Math.ceil(Number(storageObject.size) / partSize);

    return {
      objectId: storageObject.id,
      status: storageObject.status,
      uploadedParts,
      totalParts,
      uploadedBytes: uploadedBytes.toString(),
      totalBytes: storageObject.size.toString(),
    };
  }

  /**
   * Complete multipart upload
   */
  async completeUpload(
    objectId: string,
    dto: CompleteUploadDto,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const storageObject = await this.prisma.storageObject.findUnique({
      where: { id: objectId },
      include: { chunks: true },
    });

    if (!storageObject) {
      throw new NotFoundException('Upload not found');
    }

    // Check ownership
    if (storageObject.uploadedById !== userId) {
      throw new ForbiddenException('You do not own this upload');
    }

    if (!storageObject.s3UploadId) {
      throw new BadRequestException('Upload ID not found');
    }

    const { parts } = dto;

    this.logger.log(`Completing upload ${objectId} with ${parts.length} parts`);

    // Record chunks in database
    await Promise.all(
      parts.map((part) =>
        this.prisma.storageObjectChunk.upsert({
          where: {
            objectId_partNumber: {
              objectId,
              partNumber: part.partNumber,
            },
          },
          create: {
            objectId,
            partNumber: part.partNumber,
            eTag: part.eTag,
            size: BigInt(0), // We don't know exact part size from client
          },
          update: {
            eTag: part.eTag,
          },
        }),
      ),
    );

    // Complete upload with storage provider
    await this.storageProvider.completeMultipartUpload(
      storageObject.storageKey,
      storageObject.s3UploadId,
      parts,
    );

    // Update status to processing
    const updated = await this.prisma.storageObject.update({
      where: { id: objectId },
      data: { status: 'processing' },
    });

    // Emit event for post-processing
    this.eventEmitter.emit(
      OBJECT_UPLOADED_EVENT,
      new ObjectUploadedEvent(updated),
    );

    // Create audit event
    await this.createAuditEvent(userId, 'storage:upload:complete', objectId, {
      name: updated.name,
      size: updated.size.toString(),
      mimeType: updated.mimeType,
      partsCount: parts.length,
    });

    this.logger.log(`Upload completed: ${objectId}`);

    return this.mapToResponseDto(updated);
  }

  /**
   * Abort multipart upload
   */
  async abortUpload(objectId: string, userId: string): Promise<void> {
    const storageObject = await this.prisma.storageObject.findUnique({
      where: { id: objectId },
    });

    if (!storageObject) {
      throw new NotFoundException('Upload not found');
    }

    // Check ownership
    if (storageObject.uploadedById !== userId) {
      throw new ForbiddenException('You do not own this upload');
    }

    if (!storageObject.s3UploadId) {
      throw new BadRequestException('Upload ID not found');
    }

    this.logger.log(`Aborting upload ${objectId}`);

    // Abort with storage provider
    await this.storageProvider.abortMultipartUpload(
      storageObject.storageKey,
      storageObject.s3UploadId,
    );

    // Delete database records
    await this.prisma.storageObject.delete({
      where: { id: objectId },
    });

    // Create audit event
    await this.createAuditEvent(userId, 'storage:upload:abort', objectId, {
      name: storageObject.name,
      status: storageObject.status,
    });

    this.logger.log(`Upload aborted: ${objectId}`);
  }

  /**
   * Simple upload for smaller files
   */
  async simpleUpload(
    file: MultipartFile,
    userId: string,
  ): Promise<ObjectResponseDto> {
    const { filename, mimetype, file: stream } = file;

    // Issue #71: reject the type BEFORE a byte reaches the provider. The
    // stream is still unread at this point, so nothing is written and nothing
    // needs cleaning up.
    this.assertUploadAllowed(mimetype, null, userId);

    const maxFileSize = this.getMaxFileSize();

    // Generate storage key
    const timestamp = Date.now();
    const uuid = randomUUID();
    const extension = extname(filename);
    const storageKey = `uploads/${timestamp}/${uuid}${extension}`;

    this.logger.log(`Simple upload starting: ${filename}`);

    // The size limit cannot be enforced from a header the client controls, so
    // it is enforced on the bytes as they flow. The counter is also how `size`
    // gets a real value: it was written as 0 "to be updated by
    // post-processing", and nothing ever updated it.
    const counter = new ByteCounterStream(maxFileSize);
    const countedStream = stream.pipe(counter);

    let result: Awaited<ReturnType<StorageProvider['upload']>>;
    try {
      result = await this.storageProvider.upload(storageKey, countedStream, {
        mimeType: mimetype,
      });
    } catch (error) {
      // Destroy both: leaving the multipart parser buffering keeps the
      // connection alive on a request we have already refused.
      stream.destroy();
      counter.destroy();

      if (isByteLimitExceeded(error) || this.isFastifyFileTooLarge(error)) {
        await this.bestEffortDeleteKey(storageKey);
        this.logger.warn(
          `Rejected oversize upload: userId=${userId} mimeType=${mimetype} bytes=${counter.bytes}`,
        );
        throw new BadRequestException(
          fileTooLargeMessage(counter.bytes, maxFileSize),
        );
      }

      throw error;
    }

    const storageObject = await this.prisma.storageObject.create({
      data: {
        name: filename,
        size: counter.bytes,
        mimeType: mimetype,
        storageKey,
        storageProvider: 's3',
        bucket: result.bucket,
        status: 'processing',
        uploadedById: userId,
      },
    });

    // Emit event for post-processing
    this.eventEmitter.emit(
      OBJECT_UPLOADED_EVENT,
      new ObjectUploadedEvent(storageObject),
    );

    // Create audit event
    await this.createAuditEvent(userId, 'storage:upload:complete', storageObject.id, {
      name: storageObject.name,
      mimeType: storageObject.mimeType,
      uploadType: 'simple',
    });

    this.logger.log(`Simple upload completed: ${storageObject.id}`);

    return this.mapToResponseDto(storageObject);
  }

  /**
   * List user's objects with pagination and filtering
   */
  async list(
    query: ObjectListQueryDto,
    userId: string,
  ): Promise<ObjectListResponseDto> {
    const { page, pageSize, status, sortBy, sortOrder } = query;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = {
      uploadedById: userId,
      ...(status && { status }),
    };

    // Build orderBy clause
    const orderBy: any = {};
    if (sortBy === 'createdAt') {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === 'name') {
      orderBy.name = sortOrder;
    } else if (sortBy === 'size') {
      orderBy.size = sortOrder;
    }

    const [items, totalItems] = await Promise.all([
      this.prisma.storageObject.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
      this.prisma.storageObject.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      items: items.map((item) => this.mapToResponseDto(item)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Get object by ID with ownership check
   */
  async getById(id: string, user: RequestUser): Promise<ObjectResponseDto> {
    const object = await this.getObjectWithAuthCheck(id, user, 'read');
    return this.mapToResponseDto(object);
  }

  /**
   * Owner-only read for SERVER-SIDE callers that hold a user id and no request
   * (the AI attachment resolver, the media coaching services).
   *
   * Deliberately not `getById` with an empty permission list: an admin
   * resolving their own AI attachments must not be able to inline another
   * user's photo into a model call because their token happens to carry
   * `storage:read_any`. The override is an operator affordance on the storage
   * API, not a capability the AI path inherits.
   */
  async getOwnedById(id: string, userId: string): Promise<ObjectResponseDto> {
    const object = await this.getObjectWithAuthCheck(
      id,
      { id: userId, email: '', roles: [], permissions: [], isActive: true },
      'read',
    );
    return this.mapToResponseDto(object);
  }

  /**
   * Get signed download URL for an object
   */
  async getDownloadUrl(
    id: string,
    user: RequestUser,
    expiresIn?: number,
  ): Promise<DownloadUrlResponseDto> {
    const object = await this.getObjectWithAuthCheck(id, user, 'read');

    // Verify status is ready
    if (object.status !== 'ready') {
      throw new BadRequestException(
        `Object is not ready for download. Current status: ${object.status}`,
      );
    }

    const defaultExpiry = this.config.get<number>(
      'storage.signedUrlExpiry',
      3600,
    );
    const expiry = expiresIn || defaultExpiry;

    const url = await this.storageProvider.getSignedDownloadUrl(
      object.storageKey,
      { expiresIn: expiry },
    );

    this.logger.log(`Generated download URL for object ${id}, expires in ${expiry}s`);

    return {
      url,
      expiresIn: expiry,
    };
  }

  /**
   * Delete object from storage and database
   */
  async delete(id: string, user: RequestUser): Promise<void> {
    const object = await this.getObjectWithAuthCheck(id, user, 'delete');

    this.logger.log(`Deleting object ${id} from storage and database`);

    // Delete from storage provider
    await this.storageProvider.delete(object.storageKey);

    // Delete from database (cascade deletes chunks)
    await this.prisma.storageObject.delete({
      where: { id },
    });

    // Create audit event
    await this.createAuditEvent(user.id, 'storage:object:delete', id, {
      name: object.name,
      size: object.size.toString(),
      mimeType: object.mimeType,
      ...(object.uploadedById !== user.id ? { actedAsAdmin: true } : {}),
    });

    this.logger.log(`Object deleted: ${id}`);
  }

  /**
   * Update object metadata
   */
  async updateMetadata(
    id: string,
    dto: UpdateMetadataDto,
    user: RequestUser,
  ): Promise<ObjectResponseDto> {
    const object = await this.getObjectWithAuthCheck(id, user, 'write');

    // Merge new metadata with existing
    const existingMetadata = (object.metadata as Record<string, unknown>) || {};
    const mergedMetadata = {
      ...existingMetadata,
      ...dto.metadata,
    };

    // Update in database
    const updated = await this.prisma.storageObject.update({
      where: { id },
      data: { metadata: mergedMetadata as Prisma.InputJsonValue },
    });

    // Create audit event
    await this.createAuditEvent(user.id, 'storage:object:metadata:update', id, {
      name: object.name,
      metadataChanges: dto.metadata,
      ...(object.uploadedById !== user.id ? { actedAsAdmin: true } : {}),
    });

    this.logger.log(`Updated metadata for object ${id}`);

    return this.mapToResponseDto(updated);
  }

  /**
   * Helper method to get object with ownership check
   * @private
   */
  private async getObjectWithAuthCheck(
    id: string,
    user: RequestUser,
    action: ObjectAction,
  ): Promise<any> {
    const object = await this.prisma.storageObject.findUnique({
      where: { id },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    if (object.uploadedById === user.id) {
      return object;
    }

    // Issue #71: the three `storage:*_any` permissions are the only way a
    // non-owner reaches an object. 403 (not 404) is kept on purpose for RAW
    // storage objects — this is a generic, permission-based API where "you may
    // not" is the honest answer. Media attachments (#83) are a private product
    // resource and answer 404; the two are deliberately different.
    if (user.permissions?.includes(ADMIN_OVERRIDE_PERMISSION[action])) {
      return object;
    }

    throw new ForbiddenException('You do not have access to this object');
  }

  /** The configured upload ceiling, in bytes. */
  private getMaxFileSize(): number {
    return this.config.get<number>('storage.maxFileSize', 524288000);
  }

  /** The configured allowlist patterns. */
  private getAllowedMimeTypes(): string[] {
    return this.config.get<string[]>('storage.allowedMimeTypes', [
      'image/*',
      'video/*',
    ]);
  }

  /**
   * Reject a disallowed type or a declared size past the limit.
   *
   * `size` is null on the simple path, where the declared length is a header
   * the client controls and the real check happens on the bytes themselves.
   */
  private assertUploadAllowed(
    mimeType: string,
    size: number | null,
    userId: string,
  ): void {
    const allowed = this.getAllowedMimeTypes();

    if (!isMimeTypeAllowed(mimeType, allowed)) {
      this.logger.warn(
        `Rejected upload: userId=${userId} mimeType=${mimeType} reason=mime_not_allowed`,
      );
      throw new BadRequestException(
        disallowedMimeTypeMessage(mimeType, allowed),
      );
    }

    const maxFileSize = this.getMaxFileSize();
    if (size !== null && size > maxFileSize) {
      this.logger.warn(
        `Rejected upload: userId=${userId} mimeType=${mimeType} size=${size} reason=too_large`,
      );
      throw new BadRequestException(fileTooLargeMessage(size, maxFileSize));
    }
  }

  /**
   * Fastify's multipart plugin caps the simple path before our counter can;
   * its error must produce the same 400, not a 500.
   */
  private isFastifyFileTooLarge(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE'
    );
  }

  /**
   * Remove a key we wrote and then refused. Best effort: a provider failure
   * here is a leaked object, not a reason to turn the user's 400 into a 500.
   */
  private async bestEffortDeleteKey(storageKey: string): Promise<void> {
    try {
      await this.storageProvider.delete(storageKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to clean up partial upload key ${storageKey}: ${message}`,
      );
    }
  }

  /**
   * Map Prisma model to response DTO
   */
  private mapToResponseDto(obj: any): ObjectResponseDto {
    return {
      id: obj.id,
      name: obj.name,
      size: obj.size.toString(),
      mimeType: obj.mimeType,
      status: obj.status,
      metadata: obj.metadata as Record<string, unknown> | null,
      createdAt: obj.createdAt.toISOString(),
      updatedAt: obj.updatedAt.toISOString(),
    };
  }

  /**
   * Create audit event for storage operations
   */
  private async createAuditEvent(
    userId: string,
    action: string,
    objectId: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'storage_object',
        targetId: objectId,
        meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
