import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MediaAttachment,
  MediaKind,
  Prisma,
  StorageObject,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ObjectsService } from '../storage/objects/objects.service';
import { isMimeTypeAllowed } from '../storage/objects/mime-allowlist';
import type { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateMediaAttachmentDto } from './dto/create-media-attachment.dto';
import {
  MediaAttachmentListQueryDto,
  MediaAttachmentListResponseDto,
} from './dto/media-attachment-list-query.dto';
import {
  MediaAttachmentResponse,
  MediaPreviewQueryDto,
  MediaPreviewVariant,
} from './dto/media-attachment-response.dto';

/** What an attachment may point at. Photos and video only. */
const ATTACHABLE_MIME_PATTERNS = ['image/*', 'video/*'] as const;

/** `_processing` keys this service reads, named once. */
const VIDEO_FRAMES_KEY = 'video-frames';
const IMAGE_NORMALIZE_KEY = 'image-normalize';

type AttachmentWithObject = MediaAttachment & { storageObject: StorageObject };

interface VideoFramesMeta {
  frames?: Array<{ objectId: string; timestampMs: number }>;
  durationMs?: number;
  width?: number;
  height?: number;
  frameCount?: number;
}

interface ImageNormalizeMeta {
  aiVariantObjectId?: string;
  width?: number;
  height?: number;
}

/**
 * The product-level view of an upload (issue #83, epic #67).
 *
 * Ownership here is **404, never 403** — for both a missing id and a foreign
 * one. That is the opposite of `ObjectsService`, and deliberately so: the
 * storage API is generic and permission-based, so "you may not" is an honest
 * answer there. An attachment is a private product resource, and telling a
 * caller that an id they do not own exists is an enumeration primitive.
 */
@Injectable()
export class MediaAttachmentsService {
  private readonly logger = new Logger(MediaAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objects: ObjectsService,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateMediaAttachmentDto,
    userId: string,
  ): Promise<MediaAttachmentResponse> {
    const object = await this.prisma.storageObject.findUnique({
      where: { id: dto.storageObjectId },
    });

    // A foreign object and a missing one are the same answer, for the same
    // reason the attachment routes answer 404.
    if (!object || object.uploadedById !== userId) {
      throw new NotFoundException('Storage object not found');
    }

    if (!isMimeTypeAllowed(object.mimeType, ATTACHABLE_MIME_PATTERNS)) {
      throw new BadRequestException(
        `Media attachments accept images and video; this object is ${object.mimeType}`,
      );
    }

    if (object.status === 'failed') {
      throw new BadRequestException(
        'This upload failed processing and cannot be attached',
      );
    }

    const kind: MediaKind = object.mimeType.startsWith('video/')
      ? 'VIDEO'
      : 'PHOTO';

    let attachment: AttachmentWithObject;
    try {
      attachment = await this.prisma.mediaAttachment.create({
        data: {
          userId,
          storageObjectId: object.id,
          kind,
          purpose: dto.purpose,
          targetType: dto.targetType ?? null,
          targetId: dto.targetId ?? null,
        },
        include: { storageObject: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // The unique index on `storage_object_id` (#74): one attachment per
        // upload, so re-purposing means uploading again.
        throw new ConflictException('This upload is already attached');
      }
      throw error;
    }

    await this.audit(userId, 'media:attach', attachment.id, {
      storageObjectId: object.id,
      purpose: attachment.purpose,
      targetType: attachment.targetType,
      targetId: attachment.targetId,
      kind,
    });

    this.logger.log(
      `Attached media ${attachment.id} (${kind}, ${attachment.purpose})`,
    );

    return this.toResponse(attachment);
  }

  async list(
    query: MediaAttachmentListQueryDto,
    userId: string,
  ): Promise<MediaAttachmentListResponseDto> {
    const { page, pageSize, targetType, targetId, purpose } = query;

    const where: Prisma.MediaAttachmentWhereInput = {
      userId,
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(purpose ? { purpose } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.mediaAttachment.findMany({
        where,
        include: { storageObject: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.mediaAttachment.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item as AttachmentWithObject)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  async getById(
    id: string,
    userId: string,
  ): Promise<MediaAttachmentResponse> {
    return this.toResponse(await this.getOwned(id, userId));
  }

  /**
   * The one place ownership is decided. Missing and foreign collapse to the
   * same `NotFoundException` — never 403, so existence is not leaked.
   */
  async getOwned(id: string, userId: string): Promise<AttachmentWithObject> {
    const attachment = await this.prisma.mediaAttachment.findUnique({
      where: { id },
      include: { storageObject: true },
    });

    if (!attachment || attachment.userId !== userId) {
      throw new NotFoundException('Media attachment not found');
    }

    return attachment as AttachmentWithObject;
  }

  async delete(id: string, user: RequestUser): Promise<void> {
    const attachment = await this.getOwned(id, user.id);

    // Delete the row first, then the bytes. The FK cascade would remove the
    // row anyway, but doing it explicitly makes the audit order deterministic
    // — and the S3 calls stay outside any transaction, where they belong.
    await this.prisma.mediaAttachment.delete({ where: { id } });

    await this.audit(user.id, 'media:delete', id, {
      storageObjectId: attachment.storageObjectId,
      purpose: attachment.purpose,
    });

    // Cascades to the video's sampled frames (#79).
    await this.objects.delete(attachment.storageObjectId, user);

    this.logger.log(`Deleted media attachment ${id}`);
  }

  async getPreviewUrl(
    id: string,
    userId: string,
    query: MediaPreviewQueryDto,
  ): Promise<{ url: string; expiresIn: number; variant: MediaPreviewVariant }> {
    const attachment = await this.getOwned(id, userId);
    const object = attachment.storageObject;

    if (object.status !== 'ready') {
      throw new BadRequestException(
        `Media is not ready for preview. Current status: ${object.status}`,
      );
    }

    const { key, variant } = await this.resolvePreviewKey(object, query);

    const expiresIn = this.config.get<number>('storage.signedUrlExpiry', 3600);
    const url = await this.objects.getSignedUrlForKey(key, expiresIn);

    return { url, expiresIn, variant };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async resolvePreviewKey(
    object: StorageObject,
    query: MediaPreviewQueryDto,
  ): Promise<{ key: string; variant: MediaPreviewVariant }> {
    const processing = this.processingMetadata(object);

    if (query.variant === 'ai') {
      const normalized = processing[IMAGE_NORMALIZE_KEY] as
        | ImageNormalizeMeta
        | undefined;

      if (normalized?.aiVariantObjectId) {
        const child = await this.prisma.storageObject.findUnique({
          where: { id: normalized.aiVariantObjectId },
          select: { storageKey: true, status: true },
        });

        if (child?.status === 'ready') {
          return { key: child.storageKey, variant: 'ai' };
        }
      }

      // Falling back rather than failing: a caller asking for the AI variant
      // wants a picture, and `variant` in the response says which one it got.
      return { key: object.storageKey, variant: 'original' };
    }

    if (query.variant === 'frame') {
      const frames =
        (processing[VIDEO_FRAMES_KEY] as VideoFramesMeta | undefined)?.frames ??
        [];
      const frame = frames[query.frameIndex];

      if (!frame) {
        throw new BadRequestException(
          `Frame ${query.frameIndex} does not exist; this media has ${frames.length} frames`,
        );
      }

      const child = await this.prisma.storageObject.findUnique({
        where: { id: frame.objectId },
        select: { storageKey: true },
      });

      if (!child) {
        // A frame deleted directly leaves a dangling entry (#79 documents
        // this rather than guarding it); a client asking for it gets a
        // readable 400 rather than a signed URL to nothing.
        throw new BadRequestException('That frame is no longer available');
      }

      return { key: child.storageKey, variant: 'frame' };
    }

    return { key: object.storageKey, variant: 'original' };
  }

  private processingMetadata(object: StorageObject): Record<string, unknown> {
    const metadata = (object.metadata ?? {}) as Record<string, unknown>;
    return (metadata._processing ?? {}) as Record<string, unknown>;
  }

  private toResponse(attachment: AttachmentWithObject): MediaAttachmentResponse {
    const object = attachment.storageObject;
    const processing = this.processingMetadata(object);

    const frames = processing[VIDEO_FRAMES_KEY] as VideoFramesMeta | undefined;
    const normalized = processing[IMAGE_NORMALIZE_KEY] as
      | ImageNormalizeMeta
      | undefined;

    return {
      id: attachment.id,
      storageObjectId: attachment.storageObjectId,
      kind: attachment.kind,
      purpose: attachment.purpose,
      targetType: attachment.targetType as never,
      targetId: attachment.targetId,
      processingStatus: this.deriveProcessingStatus(object.status),
      processingError: this.firstProcessingError(processing),
      media: {
        mimeType: object.mimeType,
        size: object.size.toString(),
        width: frames?.width ?? normalized?.width ?? null,
        height: frames?.height ?? normalized?.height ?? null,
        durationMs: frames?.durationMs ?? null,
        frameCount: frames?.frameCount ?? null,
      },
      aiSummary: (attachment.aiSummary ?? null) as Record<
        string,
        unknown
      > | null,
      createdAt: attachment.createdAt.toISOString(),
      updatedAt: attachment.updatedAt.toISOString(),
    };
  }

  /**
   * Five storage statuses collapse to the three a client can act on: wait,
   * retry, or ask the coach.
   */
  private deriveProcessingStatus(
    status: StorageObject['status'],
  ): 'processing' | 'ready' | 'failed' {
    if (status === 'ready') return 'ready';
    if (status === 'failed') return 'failed';
    return 'processing';
  }

  /** The first `<processor>_error` string the pipeline recorded, or null. */
  private firstProcessingError(
    processing: Record<string, unknown>,
  ): string | null {
    for (const [key, value] of Object.entries(processing)) {
      if (key.endsWith('_error') && typeof value === 'string') {
        return value;
      }
    }
    return null;
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'media_attachment',
        targetId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
