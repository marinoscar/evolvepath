import { Module } from '@nestjs/common';
import { StorageProvidersModule } from './providers/storage-providers.module';
import { ObjectProcessingModule } from './processing/object-processing.module';
import { CommonModule } from '../common/common.module';
import { ObjectsController } from './objects/objects.controller';
import { ObjectsService } from './objects/objects.service';
import { StorageCleanupTask } from './tasks/storage-cleanup.task';
import { StorageQuotaService } from './objects/storage-quota.service';
import { StorageQuotaController } from './objects/storage-quota.controller';

@Module({
  imports: [
    StorageProvidersModule,
    ObjectProcessingModule,
    CommonModule,
  ],
  controllers: [ObjectsController, StorageQuotaController],
  providers: [ObjectsService, StorageQuotaService, StorageCleanupTask],
  exports: [ObjectsService, StorageQuotaService],
})
export class StorageModule {}
