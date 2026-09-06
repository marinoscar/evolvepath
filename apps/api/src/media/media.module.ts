import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { MediaAttachmentsController } from './media-attachments.controller';
import { MediaAttachmentsService } from './media-attachments.service';

/**
 * The product-level media API (issue #83, epic #67).
 *
 * Depends on `StorageModule` for `ObjectsService` — deleting an attachment
 * must go through the same path that cascades a video's sampled frames, rather
 * than growing a second deletion story — and on `AiModule` for the gateway and
 * its per-user throttle (issue #96).
 */
@Module({
  imports: [PrismaModule, StorageModule, AiModule],
  controllers: [MediaAttachmentsController],
  providers: [MediaAttachmentsService],
  exports: [MediaAttachmentsService],
})
export class MediaModule {}
