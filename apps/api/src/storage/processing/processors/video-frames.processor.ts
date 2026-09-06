import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageObject } from '@prisma/client';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { trace } from '@opentelemetry/api';

import { PrismaService } from '../../../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../../providers/storage-provider.interface';
import type { StorageProvider } from '../../providers/storage-provider.interface';
import {
  ObjectProcessor,
  ObjectProcessorResult,
} from '../object-processor.interface';

const execFileAsync = promisify(execFile);
const tracer = trace.getTracer('evolvepath-api');

/** ffprobe is fast; a video that takes 30 s to describe is not a phone clip. */
const PROBE_TIMEOUT_MS = 30_000;
/** One frame extract. Generous, because `-ss` on a long file can seek slowly. */
const EXTRACT_TIMEOUT_MS = 60_000;
/** Stderr is put in metadata, which is read by humans and shipped to clients. */
const MAX_STDERR_CHARS = 500;

/**
 * The shape written to `metadata._processing['video-frames']`.
 *
 * This is a CONTRACT, not an implementation detail: `AiAttachmentResolverService`
 * reads `frames[].objectId` from exactly this key to expand a video into image
 * parts. The key is the processor's `name` — the pipeline stores results at
 * `allMetadata[processor.name]` — so renaming the processor silently breaks
 * every video the coach has ever been shown.
 */
export interface VideoFramesMetadata {
  frames: Array<{ objectId: string; timestampMs: number }>;
  durationMs: number;
  width: number;
  height: number;
  frameCount: number;
}

interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
}

/**
 * Turns an uploaded video into a handful of evenly spaced JPEG frames
 * (issue #79, epic #67).
 *
 * The AI gateway can only send images. A form-check video is the single most
 * valuable media input in the Health domain (VISION §14; PRD §41, §45), and
 * the only way to give the coach one is to reduce it to representative frames
 * — PRD §87's "smallest sufficient context" read literally.
 *
 * Evenly spaced is the V1 rule, deliberately. Scene-change detection would
 * pick the moments where the picture changes most, which in a squat video is
 * the moment somebody walks past the camera.
 */
@Injectable()
export class VideoFramesProcessor implements ObjectProcessor {
  private readonly logger = new Logger(VideoFramesProcessor.name);

  /**
   * This string IS the metadata key the resolver reads. Hyphen, exactly.
   */
  readonly name = 'video-frames';
  readonly priority = 50;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly config: ConfigService,
  ) {}

  canProcess(object: StorageObject): boolean {
    // The `derivedFrom` guard is what stops recursion: every frame this
    // processor writes is itself a StorageObject, and a frame is not a video —
    // but a future processor that emits a video derivative would be, and the
    // guard costs nothing now and everything later.
    const metadata = object.metadata as Record<string, unknown> | null;
    return object.mimeType.startsWith('video/') && !metadata?.derivedFrom;
  }

  async process(
    object: StorageObject,
    getStream: () => Promise<Readable>,
  ): Promise<ObjectProcessorResult> {
    return tracer.startActiveSpan('storage.video-frames', async (span) => {
      span.setAttribute('storage.object_id', object.id);

      const maxFrames = this.config.get<number>('ai.video.maxFrames', 8);
      const maxDurationSeconds = this.config.get<number>(
        'ai.video.maxDurationSeconds',
        120,
      );
      const longestEdge = this.config.get<number>(
        'ai.video.frameLongestEdge',
        1024,
      );

      let tempDir: string | undefined;
      const createdObjectIds: string[] = [];
      const createdKeys: string[] = [];

      try {
        tempDir = await mkdtemp(join(tmpdir(), 'evolvepath-video-'));
        const inputPath = join(tempDir, 'input');

        // The whole file is written to disk before ffmpeg touches it, on
        // purpose: MP4 `moov` atoms are routinely at the END of the file, so a
        // non-seekable stream makes ffprobe report nothing at all for exactly
        // the format phones produce.
        await pipeline(await getStream(), createWriteStream(inputPath));

        const probe = await this.probe(inputPath);
        if (!probe) {
          return { success: false, error: 'no video stream' };
        }

        span.setAttribute('video.duration_ms', probe.durationMs);

        if (probe.durationMs > maxDurationSeconds * 1000) {
          // A refusal rather than a truncation: sampling the first two minutes
          // of a ten-minute video hands the coach frames of something the user
          // did not ask about.
          return {
            success: false,
            error: `video is ${Math.round(probe.durationMs / 1000)}s; the limit is ${maxDurationSeconds}s`,
          };
        }

        // A one-second clip yields two frames, not eight near-identical ones.
        const frameCount = Math.min(
          maxFrames,
          Math.max(1, Math.floor(probe.durationMs / 500)),
        );
        span.setAttribute('video.frame_count', frameCount);

        const scaled = this.scaledDimensions(probe, longestEdge);
        const frames: VideoFramesMetadata['frames'] = [];

        for (let i = 0; i < frameCount; i += 1) {
          // Sample at the MIDDLE of each slice. Starting at 0 gives the frame
          // before the lift begins, which for a form check is a picture of
          // somebody standing still.
          const timestampMs = Math.round(
            ((i + 0.5) * probe.durationMs) / frameCount,
          );
          const framePath = join(tempDir, `frame-${i}.jpg`);

          await this.extractFrame(
            inputPath,
            framePath,
            timestampMs,
            longestEdge,
          );

          const buffer = await readFile(framePath);
          const key = `derived/${object.id}/frame-${i}.jpg`;

          await this.storageProvider.upload(key, Readable.from(buffer), {
            mimeType: 'image/jpeg',
            contentLength: buffer.byteLength,
          });
          createdKeys.push(key);

          const child = await this.prisma.storageObject.create({
            data: {
              name: `frame-${i}.jpg`,
              size: BigInt(buffer.byteLength),
              mimeType: 'image/jpeg',
              storageKey: key,
              storageProvider: 's3',
              bucket: this.storageProvider.getBucket(),
              // Born ready: no OBJECT_UPLOADED_EVENT is emitted for a frame,
              // because there is nothing left to do to it and the pipeline
              // would only re-enter itself.
              status: 'ready',
              uploadedById: object.uploadedById,
              metadata: {
                derivedFrom: object.id,
                frameIndex: i,
                timestampMs,
                width: scaled.width,
                height: scaled.height,
              },
            },
          });

          createdObjectIds.push(child.id);
          frames.push({ objectId: child.id, timestampMs });
        }

        this.logger.log(
          `Sampled ${frames.length} frames from video ${object.id} (${probe.durationMs}ms)`,
        );

        return {
          success: true,
          metadata: {
            frames,
            durationMs: probe.durationMs,
            width: probe.width,
            height: probe.height,
            frameCount: frames.length,
          } satisfies VideoFramesMetadata,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Video processing failed for ${object.id}: ${message}`);

        // A `failed` parent that left half its frames behind is worse than one
        // that left none: the resolver would send an arbitrary prefix of the
        // video and nothing would say so.
        await this.cleanUpChildren(createdObjectIds, createdKeys);

        return { success: false, error: message.slice(0, MAX_STDERR_CHARS) };
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
        span.end();
      }
    });
  }

  /**
   * Read duration and display dimensions, or null when there is no video
   * stream at all (an audio file with a `video/` type, a corrupt upload).
   */
  private async probe(inputPath: string): Promise<ProbeResult | null> {
    const ffprobePath = this.config.get<string>('ai.video.ffprobePath', 'ffprobe');

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        ffprobePath,
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height,duration,side_data_list:stream_tags=rotate:format=duration',
          '-of',
          'json',
          inputPath,
        ],
        { timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      ));
    } catch (error) {
      throw new Error(`ffprobe failed: ${this.describeExecError(error)}`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('ffprobe returned unparseable output');
    }

    const stream = parsed?.streams?.[0];
    if (!stream || !stream.width || !stream.height) {
      return null;
    }

    const durationSeconds =
      Number(stream.duration) || Number(parsed?.format?.duration) || 0;
    if (!durationSeconds) {
      return null;
    }

    // Rotation lives in `side_data_list[].rotation` on newer builds and
    // `tags.rotate` on older ones. Both are in the wild — iOS writes one,
    // older Android the other — and getting it wrong produces a portrait
    // video described as landscape, which is exactly the kind of wrong that
    // no test written against a synthetic fixture would catch.
    const rotation = Math.abs(
      Number(
        stream.side_data_list?.find(
          (entry: any) => entry?.rotation !== undefined,
        )?.rotation ??
          stream.tags?.rotate ??
          0,
      ),
    );
    const swapped = rotation === 90 || rotation === 270;

    return {
      durationMs: Math.round(durationSeconds * 1000),
      width: swapped ? stream.height : stream.width,
      height: swapped ? stream.width : stream.height,
    };
  }

  /** One `-ss`-before-`-i` fast seek, one frame, scaled to the longest edge. */
  private async extractFrame(
    inputPath: string,
    outputPath: string,
    timestampMs: number,
    longestEdge: number,
  ): Promise<void> {
    const ffmpegPath = this.config.get<string>('ai.video.ffmpegPath', 'ffmpeg');

    try {
      await execFileAsync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          // Before `-i`: input seeking, which is orders of magnitude faster
          // than decoding from the start of the file for every frame.
          '-ss',
          (timestampMs / 1000).toFixed(3),
          '-i',
          inputPath,
          '-frames:v',
          '1',
          '-vf',
          `scale='if(gt(iw,ih),min(${longestEdge},iw),-2)':'if(gt(iw,ih),-2,min(${longestEdge},ih))'`,
          // ~quality 80. Good enough for a model to read a bar path from.
          '-q:v',
          '3',
          '-y',
          outputPath,
        ],
        {
          timeout: EXTRACT_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
    } catch (error) {
      throw new Error(`ffmpeg failed: ${this.describeExecError(error)}`);
    }
  }

  /**
   * What the frames will measure, computed rather than re-probed.
   *
   * `-2` in the scale filter means "keep the aspect ratio, round to an even
   * number", which is what H.264 chroma subsampling requires; reproducing that
   * here keeps the metadata honest without a second ffprobe per frame.
   */
  private scaledDimensions(
    probe: ProbeResult,
    longestEdge: number,
  ): { width: number; height: number } {
    const { width, height } = probe;
    const longest = Math.max(width, height);

    if (longest <= longestEdge) {
      return { width, height };
    }

    const ratio = longestEdge / longest;
    const round2 = (value: number) => Math.max(2, Math.round(value / 2) * 2);

    return width >= height
      ? { width: longestEdge, height: round2(height * ratio) }
      : { width: round2(width * ratio), height: longestEdge };
  }

  /** Remove frames written before a later one failed. Best effort throughout. */
  private async cleanUpChildren(
    objectIds: string[],
    keys: string[],
  ): Promise<void> {
    for (const key of keys) {
      try {
        await this.storageProvider.delete(key);
      } catch (error) {
        this.logger.warn(
          `Failed to remove partial frame key ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (objectIds.length > 0) {
      try {
        await this.prisma.storageObject.deleteMany({
          where: { id: { in: objectIds } },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to remove partial frame rows: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** Truncated stderr, because this string lands in metadata a client reads. */
  private describeExecError(error: unknown): string {
    const stderr = (error as { stderr?: string })?.stderr;
    if (typeof stderr === 'string' && stderr.trim()) {
      return stderr.trim().slice(-MAX_STDERR_CHARS);
    }
    return error instanceof Error ? error.message : String(error);
  }
}
