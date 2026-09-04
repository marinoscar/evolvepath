import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { ObjectsService } from '../../storage/objects/objects.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../storage/providers/storage-provider.interface';
import { AiProviderError } from '../gateway/ai-errors';
import type {
  AiContentPart,
  AiImageDetail,
} from '../providers/ai-provider.interface';
import type { AiAttachment } from '../gateway/ai-gateway.types';

// =============================================================================
// AiAttachmentResolverService (issue #26, epic #20)
// =============================================================================
//
// Turns "storage object 3f1c…" into bytes the model can see. VISION §14 and
// PRD §37/§46 are the product reason: equipment photos, meal photos and
// form-check video frames are inputs to coaching, not decoration.
//
// -----------------------------------------------------------------------------
// EVERY OBJECT GOES THROUGH `ObjectsService.getById(id, userId)` FIRST
// -----------------------------------------------------------------------------
//
// That is the existing ownership check, and it is the ONLY thing standing
// between "I can name a uuid" and "the model describes somebody else's photo
// back to me". It applies to VIDEO FRAMES TOO, individually — a frame is a
// storage object of its own, and skipping the check for it because its parent
// passed would make a forged `_processing` blob a read primitive.
//
// -----------------------------------------------------------------------------
// INLINE BASE64, NOT SIGNED URLS
// -----------------------------------------------------------------------------
//
// A signed URL means handing OpenAI a credential that reaches this deployment's
// storage, with a lifetime we would have to reason about and a fetch we cannot
// observe. Inlining keeps the whole exchange inside one request the user's own
// key pays for. `mode` is declared so E03 can add the alternative deliberately;
// selecting it today throws AT BOOT rather than at the first attachment, so a
// misconfiguration is a failed deploy and not a broken coaching reply.
// =============================================================================

/** What `_processing['video-frames']` looks like once E03-03 (#79) has run. */
interface VideoFramesMetadata {
  frames?: Array<{ objectId?: unknown; timestampMs?: unknown }>;
}

@Injectable()
export class AiAttachmentResolverService {
  private readonly logger = new Logger(AiAttachmentResolverService.name);

  private readonly maxImageBytes: number;
  private readonly maxImagesPerCall: number;

  constructor(
    private readonly objects: ObjectsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.maxImageBytes = config.get<number>('ai.attachments.maxImageBytes') ?? 20971520;
    this.maxImagesPerCall = config.get<number>('ai.attachments.maxImagesPerCall') ?? 10;

    const mode = config.get<string>('ai.attachments.mode') ?? 'inline';
    if (mode !== 'inline') {
      // At boot, deliberately. See the header.
      throw new Error(
        `Unsupported AI attachment mode "${mode}". Only "inline" is implemented.`,
      );
    }
  }

  /**
   * Resolve every attachment into image content parts, in the order given.
   *
   * @throws AiProviderError with code `attachment` for every failure. The
   *         gateway turns it into `ok: false`; nothing here reaches an HTTP
   *         client directly.
   */
  async resolve(
    userId: string,
    attachments: AiAttachment[] | undefined,
  ): Promise<AiContentPart[]> {
    if (!attachments?.length) return [];

    const parts: AiContentPart[] = [];

    for (const attachment of attachments) {
      const object = await this.loadOwnedObject(userId, attachment.storageObjectId);

      if (object.mimeType.startsWith('image/')) {
        parts.push(
          await this.toImagePart(
            attachment.storageObjectId,
            object.mimeType,
            attachment.detail,
          ),
        );
        continue;
      }

      if (object.mimeType.startsWith('video/')) {
        parts.push(
          ...(await this.resolveVideoFrames(
            userId,
            attachment.storageObjectId,
            object.metadata,
            attachment.detail,
          )),
        );
        continue;
      }

      throw new AiProviderError(
        'attachment',
        `Unsupported attachment type "${object.mimeType}". Only images and processed video are supported.`,
      );
    }

    // Checked ONCE, at the end, against the expanded count: a single video can
    // contribute many frames, so a per-attachment check would let ten videos
    // through as ten attachments and a hundred images.
    if (parts.length > this.maxImagesPerCall) {
      throw new AiProviderError(
        'attachment',
        `Too many images (${parts.length} > ${this.maxImagesPerCall} per call).`,
      );
    }

    return parts;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** The ownership check, plus the readiness check. Both, for every object. */
  private async loadOwnedObject(
    userId: string,
    id: string,
  ): Promise<{ mimeType: string; metadata: Record<string, unknown> | null }> {
    let object;

    try {
      object = await this.objects.getById(id, userId);
    } catch {
      // NotFoundException and ForbiddenException are collapsed into ONE message
      // on purpose: distinguishing them tells a caller whether an id they do not
      // own exists, which is exactly the enumeration the ownership check exists
      // to prevent.
      throw new AiProviderError(
        'attachment',
        `Attachment ${id} was not found.`,
      );
    }

    if (object.status !== 'ready') {
      throw new AiProviderError(
        'attachment',
        `Attachment ${id} is not ready (status: ${object.status}).`,
      );
    }

    return {
      mimeType: object.mimeType,
      metadata: (object.metadata as Record<string, unknown> | null) ?? null,
    };
  }

  /**
   * Download one image and inline it.
   *
   * The storage key is read with Prisma AFTER the ownership check has passed:
   * `ObjectResponseDto` deliberately omits it, and widening that DTO to carry it
   * would publish an internal identifier on every storage response for the
   * convenience of this one caller.
   */
  private async toImagePart(
    id: string,
    mimeType: string,
    detail: AiImageDetail | undefined,
  ): Promise<AiContentPart> {
    const row = await this.prisma.storageObject.findUnique({
      where: { id },
      select: { storageKey: true },
    });

    if (!row) {
      throw new AiProviderError('attachment', `Attachment ${id} was not found.`);
    }

    const buffer = await this.readAll(id, row.storageKey);

    if (buffer.byteLength > this.maxImageBytes) {
      throw new AiProviderError(
        'attachment',
        `Image ${id} exceeds ${this.maxImageBytes} bytes.`,
      );
    }

    return {
      type: 'image',
      mimeType,
      base64: buffer.toString('base64'),
      detail,
    };
  }

  /**
   * Expand a video into the frames E03-03 (#79) sampled for it.
   *
   * SERVER-SAMPLED, READ FROM METADATA. The alternative — sampling in the
   * browser — would mean the model sees different frames depending on the
   * client, which makes a coaching answer irreproducible and a bug report
   * unactionable.
   */
  private async resolveVideoFrames(
    userId: string,
    id: string,
    metadata: Record<string, unknown> | null,
    detail: AiImageDetail | undefined,
  ): Promise<AiContentPart[]> {
    const processing = (metadata?._processing ?? null) as Record<
      string,
      unknown
    > | null;
    const videoFrames = (processing?.['video-frames'] ??
      null) as VideoFramesMetadata | null;

    const frames = Array.isArray(videoFrames?.frames) ? videoFrames.frames : null;

    if (!frames || frames.length === 0) {
      throw new AiProviderError(
        'attachment',
        `Video ${id} has not been processed yet.`,
      );
    }

    const ordered = [...frames].sort(
      (a, b) => this.toTimestamp(a.timestampMs) - this.toTimestamp(b.timestampMs),
    );

    const parts: AiContentPart[] = [];

    for (const frame of ordered) {
      if (typeof frame.objectId !== 'string') {
        throw new AiProviderError(
          'attachment',
          `Video ${id} has an unreadable frame reference.`,
        );
      }

      // The ownership check again, per frame. See the header.
      const frameObject = await this.loadOwnedObject(userId, frame.objectId);

      if (!frameObject.mimeType.startsWith('image/')) {
        throw new AiProviderError(
          'attachment',
          `Video ${id} references a frame that is not an image.`,
        );
      }

      parts.push(
        await this.toImagePart(frame.objectId, frameObject.mimeType, detail),
      );
    }

    return parts;
  }

  private toTimestamp(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /**
   * Drain the provider's stream into a buffer, refusing early once the size
   * limit is passed.
   *
   * The early refusal matters: `maxImageBytes` defaults to 20 MiB, and without
   * a running check a mislabelled 2 GB object would be fully buffered in memory
   * before being rejected for being too large.
   */
  private async readAll(id: string, storageKey: string): Promise<Buffer> {
    let stream;

    try {
      stream = await this.storage.download(storageKey);
    } catch (err) {
      this.logger.warn(
        `Could not download attachment ${id}: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
      throw new AiProviderError(
        'attachment',
        `Attachment ${id} could not be read from storage.`,
      );
    }

    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;

      if (total > this.maxImageBytes) {
        // Stop pulling: the answer cannot change from here.
        if (typeof (stream as { destroy?: () => void }).destroy === 'function') {
          (stream as { destroy: () => void }).destroy();
        }
        throw new AiProviderError(
          'attachment',
          `Image ${id} exceeds ${this.maxImageBytes} bytes.`,
        );
      }

      chunks.push(buffer);
    }

    return Buffer.concat(chunks);
  }
}
