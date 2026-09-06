import { Readable } from 'node:stream';
import sharp from 'sharp';

import { AiAttachmentResolverService } from '../../src/ai/attachments/ai-attachment-resolver.service';
import { OpenAiProvider } from '../../src/ai/providers/openai/openai.provider';
import { createMockStorageProvider } from '../mocks/storage-provider.mock';

// =============================================================================
// What actually reaches the provider for an attachment (issue #87, epic #67)
// =============================================================================
//
// The resolver decides WHICH object's bytes to send and the provider decides
// how they are SPELLED, and neither test alone proves the thing that matters:
// that a phone photo reaches OpenAI as a 1024 px EXIF-free JPEG rather than as
// eleven megabytes of base64 carrying the user's GPS coordinates.
//
// So this drives the real resolver into the real provider with `fetch` stubbed,
// and asserts on the request body.
// =============================================================================

const USER_ID = 'user-1';

function resolver(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'ai.attachments.maxImageBytes': 20971520,
    'ai.attachments.maxImagesPerCall': 10,
    'ai.attachments.mode': 'inline',
    'ai.attachments.signedUrlTtlSeconds': 300,
    ...overrides,
  };

  const objects = { getOwnedById: jest.fn() };
  const storage = createMockStorageProvider();
  const prisma = { storageObject: { findUnique: jest.fn() } };

  const service = new AiAttachmentResolverService(
    objects as never,
    storage,
    prisma as never,
    { get: (key: string) => values[key] } as never,
  );

  return { service, objects, storage, prisma };
}

/** Capture the body the provider PUTs on the wire, without sending it. */
function captureFetch() {
  const captured: { body?: any } = {};

  jest.spyOn(global, 'fetch').mockImplementation(async (_url, init: any) => {
    captured.body = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        id: 'resp-1',
        model: 'gpt-test',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '{}' }] },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  return captured;
}

async function generateWith(parts: unknown[]) {
  const provider = new OpenAiProvider();
  await provider.generate(
    { apiKey: 'sk-test', baseUrl: 'https://api.openai.test/v1' },
    {
      model: 'gpt-test',
      input: parts as never,
      jsonSchema: { name: 's', schema: { type: 'object' } as never },
      timeoutMs: 5000,
    } as never,
  );
}

describe('attachment payloads reaching the provider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the normalized variant’s bytes, not the original’s', async () => {
    const original = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#777' },
    })
      .jpeg()
      .toBuffer();
    const variant = await sharp(original)
      .resize({ width: 1024, height: 1024, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const { service, objects, storage, prisma } = resolver();
    objects.getOwnedById.mockResolvedValue({
      id: 'obj-1',
      mimeType: 'image/jpeg',
      status: 'ready',
      metadata: {
        _processing: { 'image-normalize': { aiVariantObjectId: 'variant-1' } },
      },
    });
    prisma.storageObject.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'variant-1'
        ? {
            status: 'ready',
            mimeType: 'image/jpeg',
            storageKey: 'derived/obj-1/ai.jpg',
            size: BigInt(variant.byteLength),
          }
        : {
            storageKey: 'uploads/1/photo.jpg',
            size: BigInt(original.byteLength),
          },
    );
    storage.download.mockResolvedValue(Readable.from([variant]));

    const parts = await service.resolve(USER_ID, [
      { storageObjectId: 'obj-1' },
    ]);
    const captured = captureFetch();
    await generateWith([{ type: 'text', text: 'look' }, ...parts]);

    const image = captured.body.input[0].content[1];
    expect(image.type).toBe('input_image');
    expect(image.image_url.startsWith('data:image/jpeg;base64,')).toBe(true);

    // The whole point: under 400 KiB, where the original is megabytes.
    expect(image.image_url.length).toBeLessThan(400 * 1024);
    expect(storage.download).toHaveBeenCalledWith('derived/obj-1/ai.jpg');
  });

  it('sends one image part per sampled frame of a video', async () => {
    const { service, objects, storage, prisma } = resolver();

    objects.getOwnedById.mockImplementation(async (id: string) =>
      id === 'vid-1'
        ? {
            id,
            mimeType: 'video/mp4',
            status: 'ready',
            metadata: {
              _processing: {
                'video-frames': {
                  frames: [
                    { objectId: 'f-0', timestampMs: 250 },
                    { objectId: 'f-1', timestampMs: 750 },
                    { objectId: 'f-2', timestampMs: 1250 },
                    { objectId: 'f-3', timestampMs: 1750 },
                  ],
                },
              },
            },
          }
        : { id, mimeType: 'image/jpeg', status: 'ready', metadata: null },
    );
    prisma.storageObject.findUnique.mockResolvedValue({
      storageKey: 'derived/vid-1/frame.jpg',
      size: BigInt(100),
    });
    storage.download.mockImplementation(async () =>
      Readable.from([Buffer.from('JPEGBYTES')]),
    );

    const parts = await service.resolve(USER_ID, [
      { storageObjectId: 'vid-1', detail: 'low' },
    ]);
    const captured = captureFetch();
    await generateWith(parts);

    const images = captured.body.input[0].content;
    expect(images).toHaveLength(4);
    // `low` detail for frames keeps eight-frame calls affordable.
    expect(images.every((i: any) => i.detail === 'low')).toBe(true);
  });

  it('sends an http URL and no data URL in signed-url mode', async () => {
    const { service, objects, storage, prisma } = resolver({
      'ai.attachments.mode': 'signed-url',
    });
    objects.getOwnedById.mockResolvedValue({
      id: 'obj-1',
      mimeType: 'image/jpeg',
      status: 'ready',
      metadata: null,
    });
    prisma.storageObject.findUnique.mockResolvedValue({
      storageKey: 'uploads/1/photo.jpg',
      size: BigInt(100),
    });
    storage.getSignedDownloadUrl.mockResolvedValue(
      'https://storage.example/uploads/1/photo.jpg?X-Amz-Signature=abc',
    );

    const parts = await service.resolve(USER_ID, [
      { storageObjectId: 'obj-1' },
    ]);
    const captured = captureFetch();
    await generateWith(parts);

    const image = captured.body.input[0].content[0];
    expect(image.image_url).toBe(
      'https://storage.example/uploads/1/photo.jpg?X-Amz-Signature=abc',
    );
    expect(image.image_url).not.toContain('data:');
    // The bytes never passed through this process.
    expect(storage.download).not.toHaveBeenCalled();
  });
});
