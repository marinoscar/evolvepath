import { ConfigService } from '@nestjs/config';
import { StorageObject } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { PrismaService } from '../../../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../../providers/storage-provider.interface';
import { createMockPrismaService } from '../../../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../../../test/mocks/storage-provider.mock';
import { VideoFramesProcessor } from './video-frames.processor';

const execFileAsync = promisify(execFile);

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 &&
  spawnSync('ffprobe', ['-version']).status === 0;

function makeObject(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    id: 'video-1',
    name: 'clip.mp4',
    size: BigInt(1000),
    mimeType: 'video/mp4',
    storageKey: 'uploads/1/clip.mp4',
    storageProvider: 's3',
    bucket: 'test-bucket',
    status: 'processing',
    s3UploadId: null,
    metadata: null,
    uploadedById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StorageObject;
}

function makeProcessor(config: Record<string, unknown> = {}) {
  const prisma = createMockPrismaService();
  const provider = createMockStorageProvider();
  const values: Record<string, unknown> = {
    'ai.video.maxFrames': 8,
    'ai.video.maxDurationSeconds': 120,
    'ai.video.frameLongestEdge': 1024,
    'ai.video.ffmpegPath': 'ffmpeg',
    'ai.video.ffprobePath': 'ffprobe',
    ...config,
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;

  let nextId = 0;
  (prisma.storageObject.create as jest.Mock).mockImplementation(
    async ({ data }: any) => ({ ...data, id: `frame-obj-${nextId++}` }),
  );

  const processor = new VideoFramesProcessor(
    prisma as unknown as PrismaService,
    provider,
    configService,
  );

  return { processor, prisma, provider };
}

// `canProcess` needs no ffmpeg, so it runs everywhere.
describe('VideoFramesProcessor.canProcess', () => {
  it('claims videos and nothing else', () => {
    const { processor } = makeProcessor();

    expect(processor.canProcess(makeObject())).toBe(true);
    expect(
      processor.canProcess(makeObject({ mimeType: 'image/jpeg' })),
    ).toBe(false);
  });

  it('never re-processes an object derived from another', () => {
    // The frames this processor writes are themselves StorageObjects. Without
    // the guard, a future processor emitting a video derivative would put the
    // pipeline into a loop that nothing would notice until the bucket filled.
    const { processor } = makeProcessor();

    expect(
      processor.canProcess(
        makeObject({ metadata: { derivedFrom: 'video-1' } as any }),
      ),
    ).toBe(false);
  });

  it('is the metadata key the AI attachment resolver reads', () => {
    // `ObjectProcessingService` stores results at `allMetadata[processor.name]`
    // and `AiAttachmentResolverService` reads `_processing['video-frames']`.
    // Renaming the processor silently breaks every video the coach sees.
    const { processor } = makeProcessor();
    expect(processor.name).toBe('video-frames');
  });
});

if (!hasFfmpeg) {
  describe('VideoFramesProcessor (ffmpeg)', () => {
    it('skipped: ffmpeg not on PATH', () => {
      // Deliberately a passing test rather than a silent absence: a suite that
      // reports "0 tests" reads exactly like a suite that ran.
      expect(hasFfmpeg).toBe(false);
    });
  });
}

(hasFfmpeg ? describe : describe.skip)('VideoFramesProcessor (ffmpeg)', () => {
  let fixtureDir: string;
  let smallClip: string;
  let wideClip: string;
  let longClip: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'video-frames-fixtures-'));
    smallClip = join(fixtureDir, 'testsrc.mp4');
    wideClip = join(fixtureDir, 'wide.mp4');
    longClip = join(fixtureDir, 'long.mp4');

    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10',
      '-pix_fmt', 'yuv420p', '-y', smallClip,
    ]);
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1280x720:rate=10',
      '-pix_fmt', 'yuv420p', '-y', wideClip,
    ]);
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x240:rate=5',
      '-pix_fmt', 'yuv420p', '-y', longClip,
    ]);
  }, 120_000);

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  const streamOf = (path: string) => async () => {
    const { createReadStream } = await import('node:fs');
    return createReadStream(path) as unknown as Readable;
  };

  it('samples floor(duration/500ms) frames at the middle of each slice', async () => {
    const { processor } = makeProcessor();

    const result = await processor.process(makeObject(), streamOf(smallClip));

    expect(result.success).toBe(true);
    const meta = result.metadata as any;
    // 2000ms / 500 = 4. Eight frames of a two-second clip would be eight
    // near-identical pictures and eight times the token cost.
    expect(meta.frameCount).toBe(4);
    expect(meta.frames.map((f: any) => f.timestampMs)).toEqual([
      250, 750, 1250, 1750,
    ]);
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
    expect(meta.durationMs).toBeGreaterThan(1900);
    expect(meta.durationMs).toBeLessThan(2100);
  }, 60_000);

  it('respects a lowered maxFrames', async () => {
    const { processor } = makeProcessor({ 'ai.video.maxFrames': 2 });

    const result = await processor.process(makeObject(), streamOf(longClip));

    expect((result.metadata as any).frameCount).toBe(2);
  }, 60_000);

  it('writes one child object per frame, owned by the uploader and born ready', async () => {
    const { processor, prisma } = makeProcessor();

    const result = await processor.process(makeObject(), streamOf(smallClip));

    const creates = (prisma.storageObject.create as jest.Mock).mock.calls;
    expect(creates).toHaveLength(4);

    creates.forEach(([{ data }]: any, index: number) => {
      expect(data.mimeType).toBe('image/jpeg');
      // Born `ready`: nothing further is done to a frame, and emitting an
      // upload event for one would re-enter the pipeline.
      expect(data.status).toBe('ready');
      expect(data.uploadedById).toBe('user-1');
      expect(data.metadata.derivedFrom).toBe('video-1');
      expect(data.metadata.frameIndex).toBe(index);
      expect(data.storageKey).toBe(`derived/video-1/frame-${index}.jpg`);
    });

    // The metadata's objectIds are the ids of the rows just written — this is
    // what the resolver follows.
    expect((result.metadata as any).frames.map((f: any) => f.objectId)).toEqual([
      'frame-obj-0',
      'frame-obj-1',
      'frame-obj-2',
      'frame-obj-3',
    ]);
  }, 60_000);

  it('uploads real JPEG bytes', async () => {
    const { processor, provider } = makeProcessor();

    await processor.process(makeObject(), streamOf(smallClip));

    const [, stream] = (provider.upload as jest.Mock).mock.calls[0];
    const chunks: Buffer[] = [];
    for await (const chunk of stream as Readable) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    // JPEG SOI marker. Asserting on the bytes rather than the filename,
    // because ffmpeg picks its encoder from the extension and a silent
    // fallback would produce a PNG named .jpg.
    expect(buffer[0]).toBe(0xff);
    expect(buffer[1]).toBe(0xd8);
  }, 60_000);

  it('scales the longest edge down to the configured limit', async () => {
    const { processor } = makeProcessor();

    const result = await processor.process(makeObject(), streamOf(wideClip));

    const meta = result.metadata as any;
    // The top-level dimensions describe the SOURCE, not the frames — that is
    // what a client showing "1280x720 video" needs. The frames' own scaled
    // size is on each child's metadata, asserted in the next case.
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
    expect(meta.frames.length).toBeGreaterThan(0);
  }, 60_000);

  it('records the scaled frame dimensions on each child', async () => {
    const { processor, prisma } = makeProcessor({ 'ai.video.maxFrames': 1 });

    await processor.process(makeObject(), streamOf(wideClip));

    const [{ data }] = (prisma.storageObject.create as jest.Mock).mock.calls[0];
    // 1280x720 -> longest edge 1024 -> 1024x576.
    expect(data.metadata.width).toBe(1024);
    expect(data.metadata.height).toBe(576);
  }, 60_000);

  it('refuses a video longer than the limit and writes no frames', async () => {
    const { processor, prisma } = makeProcessor({
      'ai.video.maxDurationSeconds': 1,
    });

    const result = await processor.process(makeObject(), streamOf(longClip));

    expect(result.success).toBe(false);
    expect(result.error).toContain('1s');
    // A refusal, not a truncation: sampling the first second of a six-second
    // video hands the coach frames of something the user did not ask about.
    expect(prisma.storageObject.create).not.toHaveBeenCalled();
  }, 60_000);

  it('fails cleanly on a non-video payload rather than throwing', async () => {
    const { processor, prisma } = makeProcessor();

    const result = await processor.process(makeObject(), async () =>
      Readable.from(['not a video']),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(prisma.storageObject.create).not.toHaveBeenCalled();
  }, 60_000);

  it('truncates a long ffmpeg error before it lands in metadata', async () => {
    const { processor } = makeProcessor();

    const result = await processor.process(makeObject(), async () =>
      Readable.from([Buffer.alloc(4096, 0x41)]),
    );

    expect(result.success).toBe(false);
    // The error string is written to `_processing['video-frames_error']` and
    // served to clients; a full ffmpeg stderr dump is not an error message.
    expect(result.error!.length).toBeLessThanOrEqual(500);
  }, 60_000);

  it('removes its temp directory after success and after failure', async () => {
    const before = readdirSync(tmpdir()).filter((n) =>
      n.startsWith('evolvepath-video-'),
    );

    const { processor } = makeProcessor();
    await processor.process(makeObject(), streamOf(smallClip));
    await processor.process(makeObject(), async () =>
      Readable.from(['not a video']),
    );

    const after = readdirSync(tmpdir()).filter((n) =>
      n.startsWith('evolvepath-video-'),
    );
    expect(after).toEqual(before);
  }, 60_000);

  it('deletes frames it already wrote when a later one fails', async () => {
    const { processor, prisma, provider } = makeProcessor();

    // Fail the third row so two frames already exist in S3 and the database.
    let calls = 0;
    (prisma.storageObject.create as jest.Mock).mockImplementation(
      async ({ data }: any) => {
        calls += 1;
        if (calls === 3) throw new Error('database went away');
        return { ...data, id: `frame-obj-${calls}` };
      },
    );

    const result = await processor.process(makeObject(), streamOf(smallClip));

    expect(result.success).toBe(false);
    // A `failed` parent that left half its frames behind is worse than one
    // that left none: the resolver would send an arbitrary prefix of the video
    // and nothing would say so.
    expect(prisma.storageObject.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['frame-obj-1', 'frame-obj-2'] } },
    });
    expect(provider.delete).toHaveBeenCalledTimes(3);
  }, 60_000);
});
