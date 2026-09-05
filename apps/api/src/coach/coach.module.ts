import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ContextAssemblerService } from './context/context-assembler.service';

/**
 * The AI coach (epic E06).
 *
 * E06-02 (#63) lands only the context assembler; the chat endpoints, the
 * mutation protocol and memory each add to this module. It imports
 * `PrismaModule` and nothing else on purpose — the assembler reads product
 * state and calls no model, so it must not depend on `AiModule`.
 */
@Module({
  imports: [PrismaModule],
  providers: [ContextAssemblerService],
  exports: [ContextAssemblerService],
})
export class CoachModule {}
