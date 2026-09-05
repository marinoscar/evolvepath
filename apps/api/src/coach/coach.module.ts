import { Module } from '@nestjs/common';

import { PathModule } from '../path/path.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ContextAssemblerService } from './context/context-assembler.service';
import { ProposalsController } from './proposals/proposals.controller';
import { ProposalsService } from './proposals/proposals.service';

/**
 * The AI coach (epic E06).
 *
 * `PathModule` is imported for `PlanVersionsService`, which is the one place
 * allowed to write a `PlanVersion`. `ProposalsService` never touches
 * `plan_versions` directly — see PRD §89.
 */
@Module({
  imports: [PrismaModule, PathModule],
  controllers: [ProposalsController],
  providers: [ContextAssemblerService, ProposalsService],
  exports: [ContextAssemblerService, ProposalsService],
})
export class CoachModule {}
