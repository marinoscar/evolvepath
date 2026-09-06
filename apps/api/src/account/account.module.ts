import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountController } from './account.controller';
import { AccountResetService } from './account-reset.service';

/**
 * The "Danger zone" (epic #220): the one place a user can erase their own
 * accumulated data, optionally including their own stored OpenAI key.
 *
 * The three non-Prisma imports are each here for something no cascade from
 * `users` reaches, and are not incidental:
 *
 *   - `StorageModule` exports `ObjectsService`, which is what actually removes
 *     an uploaded file's BYTES (and its derived frames and variants) from the
 *     storage provider. `storage_objects.uploadedById` is `SetNull`, so nothing
 *     about deleting a user reaches those files on its own.
 *   - `AiModule` exports `UserAiKeyService`, whose `deleteForUser` is the only
 *     thing that reaches the credential at `(purpose 'ai:openai:user', name
 *     <userId>)`. `credentials` has no foreign key to `users` at all.
 *   - `NotificationsModule` exports `NotificationsService`, for the mandatory
 *     `account.data_reset` email.
 *
 * Nothing is exported. This module has one HTTP surface and no internal
 * callers, deliberately: a reset is something a person asks for, never
 * something another service triggers on their behalf.
 */
@Module({
  imports: [PrismaModule, StorageModule, AiModule, NotificationsModule],
  controllers: [AccountController],
  providers: [AccountResetService],
})
export class AccountModule {}
