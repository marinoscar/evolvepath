import { Test } from '@nestjs/testing';
import { StorageObject } from '@prisma/client';

import { PrismaService } from '../../src/prisma/prisma.service';
import { ObjectProcessingService } from '../../src/storage/processing/object-processing.service';
import {
  OBJECT_PROCESSOR,
  ObjectProcessor,
} from '../../src/storage/processing/object-processor.interface';
import { ObjectUploadedEvent } from '../../src/storage/processing/events/object-uploaded.event';
import { STORAGE_PROVIDER } from '../../src/storage/providers/storage-provider.interface';
import { createMockPrismaService } from '../mocks/prisma.mock';
import { createMockStorageProvider } from '../mocks/storage-provider.mock';

// =============================================================================
// The processing pipeline stores results under the PROCESSOR'S OWN NAME
// =============================================================================
// (issue #79, epic #67)
//
// `ObjectProcessingService` writes `metadata._processing[processor.name]`, and
// `AiAttachmentResolverService` reads `_processing['video-frames']` to expand a
// video into image parts. That coupling is invisible — two files, no shared
// constant, no type — so it is asserted here with a stub processor rather than
// left to be discovered when the coach starts describing videos it was never
// shown.
//
// Deliberately a stub rather than the real VideoFramesProcessor: what is under
// test is the PIPELINE's contract, and a test that needs ffmpeg to prove where
// a JSON key lands is a test that gets skipped.
// =============================================================================

function makeObject(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    id: 'obj-1',
    name: 'clip.mp4',
    size: BigInt(10),
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

async function buildService(processors: ObjectProcessor[]) {
  const prisma = createMockPrismaService();
  const provider = createMockStorageProvider();
  (prisma.storageObject.findUnique as jest.Mock).mockResolvedValue({
    metadata: { originalName: 'kept' },
  });
  (prisma.storageObject.update as jest.Mock).mockResolvedValue({});

  const moduleRef = await Test.createTestingModule({
    providers: [
      ObjectProcessingService,
      { provide: PrismaService, useValue: prisma },
      { provide: STORAGE_PROVIDER, useValue: provider },
      { provide: OBJECT_PROCESSOR, useValue: processors },
    ],
  }).compile();

  return {
    service: moduleRef.get(ObjectProcessingService),
    prisma,
    provider,
  };
}

function stubProcessor(
  name: string,
  result: { success: boolean; metadata?: any; error?: string },
  priority = 50,
): ObjectProcessor {
  return {
    name,
    priority,
    canProcess: () => true,
    process: jest.fn().mockResolvedValue(result),
  };
}

describe('object processing pipeline (integration)', () => {
  it('stores a successful result under the processor name and marks the object ready', async () => {
    const frames = {
      frames: [{ objectId: 'frame-1', timestampMs: 250 }],
      durationMs: 2000,
      width: 320,
      height: 240,
      frameCount: 1,
    };
    const { service, prisma } = await buildService([
      stubProcessor('video-frames', { success: true, metadata: frames }),
    ]);

    await service.handleObjectUploaded(new ObjectUploadedEvent(makeObject()));

    const [{ data }] = (prisma.storageObject.update as jest.Mock).mock.calls[0];
    expect(data.status).toBe('ready');
    // The exact key AiAttachmentResolverService reads.
    expect(data.metadata._processing['video-frames']).toEqual(frames);
    // Pre-existing metadata survives; the pipeline merges rather than replaces.
    expect(data.metadata.originalName).toBe('kept');
  });

  it('stores a failure under `<name>_error` and marks the object failed', async () => {
    const { service, prisma } = await buildService([
      stubProcessor('video-frames', {
        success: false,
        error: 'video is 200s; the limit is 120s',
      }),
    ]);

    await service.handleObjectUploaded(new ObjectUploadedEvent(makeObject()));

    const [{ data }] = (prisma.storageObject.update as jest.Mock).mock.calls[0];
    expect(data.status).toBe('failed');
    expect(data.metadata._processingFailed).toBe(true);
    expect(data.metadata._processing['video-frames_error']).toContain('120s');
  });

  it('accepts the array the OBJECT_PROCESSOR factory provides', async () => {
    // NestJS has no `multi: true`; the token IS the array, and the service
    // normalizes it. `processors/README.md` documented the non-existent option
    // for the life of the module, which is why nothing was ever registered.
    const { service, prisma } = await buildService([
      stubProcessor('image-normalize', { success: true, metadata: { a: 1 } }, 40),
      stubProcessor('video-frames', { success: true, metadata: { b: 2 } }, 50),
    ]);

    await service.handleObjectUploaded(new ObjectUploadedEvent(makeObject()));

    const [{ data }] = (prisma.storageObject.update as jest.Mock).mock.calls[0];
    expect(Object.keys(data.metadata._processing).sort()).toEqual([
      'image-normalize',
      'video-frames',
    ]);
  });

  it('marks an object ready when no processor claims it', async () => {
    const { service, prisma } = await buildService([
      { ...stubProcessor('video-frames', { success: true }), canProcess: () => false },
    ]);

    await service.handleObjectUploaded(new ObjectUploadedEvent(makeObject()));

    const [{ data }] = (prisma.storageObject.update as jest.Mock).mock.calls[0];
    expect(data.status).toBe('ready');
    expect(data.metadata._processing).toEqual({});
  });

  it('treats a thrown processor the same as a returned failure', async () => {
    const throwing: ObjectProcessor = {
      name: 'video-frames',
      priority: 50,
      canProcess: () => true,
      process: jest.fn().mockRejectedValue(new Error('ffmpeg vanished')),
    };
    const { service, prisma } = await buildService([throwing]);

    // The pipeline runs on an event handler; an unhandled rejection here takes
    // the process down rather than the upload.
    await expect(
      service.handleObjectUploaded(new ObjectUploadedEvent(makeObject())),
    ).resolves.toBeUndefined();

    const [{ data }] = (prisma.storageObject.update as jest.Mock).mock.calls[0];
    expect(data.status).toBe('failed');
    expect(data.metadata._processing['video-frames_error']).toBe(
      'ffmpeg vanished',
    );
  });
});
