import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageObject } from '@prisma/client';
import { Readable } from 'node:stream';
import { trace } from '@opentelemetry/api';
import sharp from 'sharp';

import { PrismaService } from '../../../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../../providers/storage-provider.interface';
import type { StorageProvider } from '../../providers/storage-provider.interface';
import {
  ObjectProcessor,
  ObjectProcessorResult,
} from '../object-processor.interface';

const tracer = trace.getTracer('evolvepath-api');

/** HEIC/HEIF: what an iPhone actually produces, and what libvips cannot read. */
const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

/**
 * The shape written to `metadata._processing['image-normalize']`.
 *
 * `AiAttachmentResolverService` reads `aiVariantObjectId` from this key to
 * prefer the variant over the original. As with `video-frames`, the key IS the
 * processor's `name` — there is no shared constant, so renaming the processor
 * silently sends full-size originals with their EXIF intact.
 */
export interface ImageNormalizeMetadata {
  aiVariantObjectId: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceFormat: string;
  exifStripped: true;
}

/**
 * Turns a phone photo into something safe and cheap to hand a model
 * (issue #87, epic #67).
 *
 * Three problems, one processor:
 *
 * 1. **EXIF.** A photo off a phone carries GPS coordinates. Inlining it into a
 *    model request ships the user's location to a third party for no product
 *    reason at all (PRD §85, §86). `sharp` drops metadata unless asked to keep
 *    it, so the stripping is achieved by NOT calling `.withMetadata()` — which
 *    means the way to break this is to add a line, not to remove one.
 * 2. **Size.** A 12-megapixel JPEG is ~8 MiB, which is ~11 MiB of base64 in the
 *    request body, for an image the model reads at 1024 px anyway.
 * 3. **HEIC.** libvips as shipped does not decode it, so an iPhone photo would
 *    be an unreadable attachment. `heic-convert` is pure WASM and slow (~1–2 s
 *    for a 12 MP still), which is acceptable off the request path and would not
 *    be on it.
 *
 * The ORIGINAL is never modified. The user uploaded it and can download it;
 * this writes a sibling.
 */
@Injectable()
export class ImageNormalizeProcessor implements ObjectProcessor {
  private readonly logger = new Logger(ImageNormalizeProcessor.name);

  /** IS the metadata key. See `ImageNormalizeMetadata`. */
  readonly name = 'image-normalize';
  /**
   * Before video-frames. Irrelevant in practice — `canProcess` is disjoint
   * between the two — but a stable order makes a two-processor `_processing`
   * blob deterministic in tests.
   */
  readonly priority = 40;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly config: ConfigService,
  ) {}

  canProcess(object: StorageObject): boolean {
    const metadata = object.metadata as Record<string, unknown> | null;
    // `derivedFrom` excludes both video frames (already ≤ 1024 px and EXIF-free
    // by construction) and this processor's own output.
    return object.mimeType.startsWith('image/') && !metadata?.derivedFrom;
  }

  async process(
    object: StorageObject,
    getStream: () => Promise<Readable>,
  ): Promise<ObjectProcessorResult> {
    return tracer.startActiveSpan('storage.image-normalize', async (span) => {
      span.setAttribute('storage.object_id', object.id);

      const longestEdge = this.config.get<number>(
        'ai.video.frameLongestEdge',
        1024,
      );
      const maxSourceBytes = this.config.get<number>(
        'ai.attachments.maxSourceImageBytes',
        26214400,
      );

      try {
        const source = await this.readAll(await getStream(), maxSourceBytes);

        const decodable = HEIC_MIME_TYPES.includes(
          object.mimeType.toLowerCase(),
        )
          ? await this.heicToJpeg(source)
          : source;

        const pipeline = sharp(decodable)
          // Applies the EXIF orientation tag and then discards it. Without
          // this, stripping metadata turns every portrait phone photo sideways
          // — the tag was the only thing saying which way was up.
          .rotate()
          .resize({
            width: longestEdge,
            height: longestEdge,
            fit: 'inside',
            withoutEnlargement: true,
          })
          // No `.withMetadata()`. That absence is the EXIF/GPS/ICC strip.
          .jpeg({ quality: 80 });

        const { data, info } = await pipeline.toBuffer({
          resolveWithObject: true,
        });

        const sourceMeta = await sharp(decodable).metadata();

        const key = `derived/${object.id}/ai.jpg`;
        await this.storageProvider.upload(key, Readable.from(data), {
          mimeType: 'image/jpeg',
          contentLength: data.byteLength,
        });

        const child = await this.prisma.storageObject.create({
          data: {
            name: 'ai.jpg',
            size: BigInt(data.byteLength),
            mimeType: 'image/jpeg',
            storageKey: key,
            storageProvider: 's3',
            bucket: this.storageProvider.getBucket(),
            status: 'ready',
            uploadedById: object.uploadedById,
            metadata: {
              derivedFrom: object.id,
              variant: 'ai',
              width: info.width,
              height: info.height,
            },
          },
        });

        span.setAttribute('image.source_width', sourceMeta.width ?? 0);
        span.setAttribute('image.variant_width', info.width);

        this.logger.log(
          `Normalized image ${object.id}: ${sourceMeta.width}x${sourceMeta.height} -> ${info.width}x${info.height}`,
        );

        return {
          success: true,
          metadata: {
            aiVariantObjectId: child.id,
            width: info.width,
            height: info.height,
            sourceWidth: sourceMeta.width ?? 0,
            sourceHeight: sourceMeta.height ?? 0,
            sourceFormat: sourceMeta.format ?? object.mimeType,
            exifStripped: true,
          } satisfies ImageNormalizeMetadata,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Image normalization failed for ${object.id}: ${message}`,
        );
        return { success: false, error: message.slice(0, 500) };
      } finally {
        span.end();
      }
    });
  }

  /**
   * `heic-convert` is required lazily.
   *
   * It is a WASM bundle of libheif; loading it at module scope costs every boot
   * of every process a decode engine that most deployments never use.
   */
  private async heicToJpeg(buffer: Buffer): Promise<Buffer> {
    const convert = await import('heic-convert');
    const output = await convert.default({
      buffer,
      format: 'JPEG',
      quality: 0.9,
    });
    return Buffer.from(output);
  }

  /**
   * Buffer the whole image, refusing early past the cap.
   *
   * The early refusal is the point: without a running check a mislabelled 2 GB
   * object is fully buffered in memory before being rejected for being large.
   */
  private async readAll(stream: Readable, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;

      if (total > maxBytes) {
        stream.destroy();
        throw new Error(
          `image is larger than ${maxBytes} bytes and cannot be normalized`,
        );
      }

      chunks.push(buffer);
    }

    return Buffer.concat(chunks);
  }
}
