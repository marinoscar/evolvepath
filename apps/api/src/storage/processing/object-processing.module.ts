import { Module } from '@nestjs/common';
import { ObjectProcessingService } from './object-processing.service';
import { StorageProvidersModule } from '../providers/storage-providers.module';
import { StorageProcessorsModule } from './processors/storage-processors.module';

@Module({
  // StorageProcessorsModule exports the OBJECT_PROCESSOR token as an ARRAY.
  // The pipeline had zero registered processors until issue #79; every
  // uploaded object went straight to `ready` with an empty `_processing`.
  imports: [StorageProvidersModule, StorageProcessorsModule],
  providers: [ObjectProcessingService],
  exports: [ObjectProcessingService],
})
export class ObjectProcessingModule {}
