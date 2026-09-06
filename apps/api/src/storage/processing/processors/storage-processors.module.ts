import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { StorageProvidersModule } from '../../providers/storage-providers.module';
import { OBJECT_PROCESSOR } from '../object-processor.interface';
import { ImageNormalizeProcessor } from './image-normalize.processor';
import { VideoFramesProcessor } from './video-frames.processor';

/**
 * The registry of storage object processors (issue #79, epic #67).
 *
 * NestJS has no `multi: true` — the token is bound to exactly one value — so
 * the supported way to register several processors is a factory that returns
 * the ARRAY, which `ObjectProcessingService` already normalizes. Adding a
 * processor is two lines here (a provider and an `inject` entry), not a second
 * registration mechanism.
 *
 * `processors/README.md` used to document `multi: true`; it has been corrected.
 */
@Module({
  imports: [PrismaModule, StorageProvidersModule],
  providers: [
    ImageNormalizeProcessor,
    VideoFramesProcessor,
    {
      provide: OBJECT_PROCESSOR,
      useFactory: (
        imageNormalize: ImageNormalizeProcessor,
        videoFrames: VideoFramesProcessor,
      ) => [imageNormalize, videoFrames],
      inject: [ImageNormalizeProcessor, VideoFramesProcessor],
    },
  ],
  exports: [OBJECT_PROCESSOR],
})
export class StorageProcessorsModule {}
