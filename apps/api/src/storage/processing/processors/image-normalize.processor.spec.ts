import { ConfigService } from '@nestjs/config';
import { StorageObject } from '@prisma/client';
import { Readable } from 'node:stream';
import sharp from 'sharp';

import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../../../test/mocks/storage-provider.mock';
import { ImageNormalizeProcessor } from './image-normalize.processor';

function makeObject(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    id: 'img-1',
    name: 'photo.jpg',
    size: BigInt(1000),
    mimeType: 'image/jpeg',
    storageKey: 'uploads/1/photo.jpg',
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
    'ai.video.frameLongestEdge': 1024,
    'ai.attachments.maxSourceImageBytes': 26214400,
    ...config,
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;

  (prisma.storageObject.create as jest.Mock).mockImplementation(
    async ({ data }: any) => ({ ...data, id: 'variant-1' }),
  );

  const processor = new ImageNormalizeProcessor(
    prisma as unknown as PrismaService,
    provider,
    configService,
  );

  return { processor, prisma, provider };
}

/** The bytes the provider was handed, so the OUTPUT can be re-decoded. */
async function uploadedBuffer(
  provider: ReturnType<typeof createMockStorageProvider>,
): Promise<Buffer> {
  const [, stream] = (provider.upload as jest.Mock).mock.calls[0];
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('ImageNormalizeProcessor', () => {
  describe('canProcess', () => {
    it('claims images and nothing else', () => {
      const { processor } = makeProcessor();

      expect(processor.canProcess(makeObject())).toBe(true);
      expect(
        processor.canProcess(makeObject({ mimeType: 'video/mp4' })),
      ).toBe(false);
    });

    it('skips derived objects, including its own output', () => {
      // Video frames are already 1024 px and EXIF-free by construction, and
      // normalizing this processor's own variant would loop.
      const { processor } = makeProcessor();

      expect(
        processor.canProcess(
          makeObject({ metadata: { derivedFrom: 'parent' } as any }),
        ),
      ).toBe(false);
    });

    it('is the metadata key the resolver reads', () => {
      const { processor } = makeProcessor();
      expect(processor.name).toBe('image-normalize');
    });
  });

  describe('process', () => {
    const streamOf = (buffer: Buffer) => async () => Readable.from([buffer]);

    async function bigJpegWithExif(): Promise<Buffer> {
      return sharp({
        create: {
          width: 3000,
          height: 2000,
          channels: 3,
          background: '#888888',
        },
      })
        .withMetadata({
          exif: { IFD0: { Copyright: 'evolvepath-test', Artist: 'nobody' } },
        })
        .jpeg()
        .toBuffer();
    }

    it('scales the longest edge to 1024 and keeps the aspect ratio', async () => {
      const { processor } = makeProcessor();

      const result = await processor.process(
        makeObject(),
        streamOf(await bigJpegWithExif()),
      );

      expect(result.success).toBe(true);
      const meta = result.metadata as any;
      // 3000x2000 -> 1024x683.
      expect(meta.width).toBe(1024);
      expect(meta.height).toBe(683);
      expect(meta.sourceWidth).toBe(3000);
      expect(meta.sourceHeight).toBe(2000);
    });

    it('strips EXIF from the variant', async () => {
      // The stripping is achieved by NOT calling `.withMetadata()`, which
      // means the way to break it is to ADD a line. A phone photo carries GPS,
      // and inlining it into a model request ships the user's location to a
      // third party for no product reason at all (PRD §85, §86).
      const { processor, provider } = makeProcessor();
      const source = await bigJpegWithExif();

      // The source really does carry it, or this test proves nothing.
      expect((await sharp(source).metadata()).exif).toBeDefined();

      await processor.process(makeObject(), streamOf(source));

      const variant = await sharp(await uploadedBuffer(provider)).metadata();
      expect(variant.exif).toBeUndefined();
    });

    it('writes a child object marked as the AI variant', async () => {
      const { processor, prisma } = makeProcessor();

      const result = await processor.process(
        makeObject(),
        streamOf(await bigJpegWithExif()),
      );

      const [{ data }] = (prisma.storageObject.create as jest.Mock).mock
        .calls[0];
      expect(data.mimeType).toBe('image/jpeg');
      expect(data.status).toBe('ready');
      expect(data.storageKey).toBe('derived/img-1/ai.jpg');
      expect(data.uploadedById).toBe('user-1');
      expect(data.metadata).toMatchObject({
        derivedFrom: 'img-1',
        variant: 'ai',
      });
      expect((result.metadata as any).aiVariantObjectId).toBe('variant-1');
    });

    it('produces a variant far smaller than the original', async () => {
      const { processor, provider } = makeProcessor();
      const source = await bigJpegWithExif();

      await processor.process(makeObject(), streamOf(source));

      const variant = await uploadedBuffer(provider);
      expect(variant.byteLength).toBeLessThan(source.byteLength);
    });

    it('does not enlarge a small image', async () => {
      const { processor } = makeProcessor();
      const small = await sharp({
        create: { width: 200, height: 100, channels: 3, background: '#111' },
      })
        .jpeg()
        .toBuffer();

      const result = await processor.process(makeObject(), streamOf(small));

      expect((result.metadata as any).width).toBe(200);
      expect((result.metadata as any).height).toBe(100);
    });

    it('flattens a PNG with alpha without failing', async () => {
      const { processor } = makeProcessor();
      const png = await sharp({
        create: {
          width: 1200,
          height: 800,
          channels: 4,
          background: { r: 20, g: 30, b: 40, alpha: 0.4 },
        },
      })
        .png()
        .toBuffer();

      const result = await processor.process(
        makeObject({ mimeType: 'image/png' }),
        streamOf(png),
      );

      expect(result.success).toBe(true);
      expect((result.metadata as any).sourceFormat).toBe('png');
    });

    it('applies EXIF orientation before discarding it', async () => {
      // Stripping metadata without rotating first turns every portrait phone
      // photo sideways: the tag was the only thing saying which way is up.
      const { processor } = makeProcessor();
      const rotated = await sharp({
        create: { width: 1200, height: 600, channels: 3, background: '#222' },
      })
        .withMetadata({ orientation: 6 }) // 90° clockwise
        .jpeg()
        .toBuffer();

      const result = await processor.process(makeObject(), streamOf(rotated));

      // The stored pixels are now taller than wide, because orientation 6 was
      // applied rather than thrown away.
      const meta = result.metadata as any;
      expect(meta.height).toBeGreaterThan(meta.width);
    });

    it('fails cleanly on garbage bytes and writes no child', async () => {
      const { processor, prisma } = makeProcessor();

      const result = await processor.process(
        makeObject(),
        streamOf(Buffer.from('this is not an image')),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(prisma.storageObject.create).not.toHaveBeenCalled();
    });

    it('refuses a source past maxSourceImageBytes without buffering it all', async () => {
      const { processor, prisma } = makeProcessor({
        'ai.attachments.maxSourceImageBytes': 1000,
      });

      const result = await processor.process(makeObject(), async () =>
        Readable.from([Buffer.alloc(600), Buffer.alloc(600)]),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('1000 bytes');
      expect(prisma.storageObject.create).not.toHaveBeenCalled();
    });

    it('reports exifStripped so the claim is in the record, not just the code', async () => {
      const { processor } = makeProcessor();

      const result = await processor.process(
        makeObject(),
        streamOf(await bigJpegWithExif()),
      );

      expect((result.metadata as any).exifStripped).toBe(true);
    });
  });
});
