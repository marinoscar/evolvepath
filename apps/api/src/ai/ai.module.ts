import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { StorageModule } from '../storage/storage.module';

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
  imports: [PrismaModule, CredentialsModule, StorageModule, ConfigModule],
  providers: [],
  exports: [],
})
export class AiModule {}
