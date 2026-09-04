import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { StorageModule } from '../storage/storage.module';
import { StorageProvidersModule } from '../storage/providers/storage-providers.module';
import { OpenAiProvider } from './providers/openai/openai.provider';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import { AiSettingsService } from './ai-settings.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiAdminTestService } from './ai-admin-test.service';
import { AiModelCatalogService } from './model-catalog/ai-model-catalog.service';
import { TestThrottle } from './gateway/test-throttle';
import { UserAiKeyService } from './user-key/user-ai-key.service';
import { UserAiKeyController } from './user-key/user-ai-key.controller';
import { AiGatewayService } from './gateway/ai-gateway.service';
import { AiInvocationLogService } from './gateway/ai-invocation-log.service';
import { AiAttachmentResolverService } from './attachments/ai-attachment-resolver.service';

// =============================================================================
// AiModule (issue #22, epic #20)
// =============================================================================
//
// The module skeleton every later child of epic #20 hangs providers on. It is
// registered in `AppModule` from this first child even though it provides
// nothing yet, so that #23–#26 are each an addition to a graph that already
// boots rather than a new graph plus a feature in one review.
//
// NOT @Global. Consumers import it explicitly, so every user of a service that
// can reach a plaintext API key is visible in a module's `imports` list — the
// same rule `CredentialsModule` follows and for the same reason.
//
// The imports are the dependencies the later children need, declared now:
//   • PrismaModule      — the `ai_invocations` writes (#21, #24, #25, #26)
//   • CredentialsModule — the platform key (#24) and every user key (#25)
//   • StorageModule     — attachment resolution for vision personas (#26)
//   • ConfigModule      — `OPENAI_BASE_URL`, timeouts, attachment limits (#23)
//
// ConfigModule is already global (`AppModule` calls `forRoot({ isGlobal: true })`),
// so importing it here changes nothing at runtime. It is listed anyway because
// this module's providers genuinely depend on configuration, and a reader
// should not have to know about a distant `isGlobal` to see that.
// =============================================================================

@Module({
  imports: [
    PrismaModule,
    CredentialsModule,
    StorageModule,
    // The STORAGE_PROVIDER token itself, for the attachment resolver's raw
    // downloads. StorageModule exports ObjectsService (the ownership check) but
    // not the provider, and the resolver needs both.
    StorageProvidersModule,
    ConfigModule,
  ],
  controllers: [AiSettingsController, UserAiKeyController],
  providers: [
    OpenAiProvider,
    AiProviderRegistry,
    AiSettingsService,
    AiModelCatalogService,
    AiAdminTestService,
    TestThrottle,
    UserAiKeyService,
    AiGatewayService,
    AiInvocationLogService,
    AiAttachmentResolverService,
  ],
  // The final export list for epic #20. `AiGatewayService` is what E02-E12
  // import; the other two are for the surfaces that configure it.
  exports: [
    AiGatewayService,
    UserAiKeyService,
    AiSettingsService,
    AiProviderRegistry,
  ],
})
export class AiModule {}
