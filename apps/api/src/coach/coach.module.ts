import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PathModule } from '../path/path.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { CoachConversationsService } from './coach-conversations.service';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';
import { ContextAssemblerService } from './context/context-assembler.service';
import { MemoryInsightsController } from './memory/memory-insights.controller';
import { MemoryInsightsService } from './memory/memory-insights.service';
import { PatternAnalysisService } from './memory/pattern-analysis.service';
import { ProposalsController } from './proposals/proposals.controller';
import { ProposalsService } from './proposals/proposals.service';
import { SafetyModule } from './safety/safety.module';

/**
 * The AI coach (epic E06).
 *
 * `PathModule` is imported for `PlanVersionsService`, the one place allowed to
 * write a `PlanVersion`; `SafetyModule` for the pre-check that runs before any
 * coach call. Neither `CoachService` nor `ProposalsService` touches
 * `plan_versions` directly — see PRD §89.
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    SafetyModule,
    PathModule,
    UserProfileModule,
    NotificationsModule,
  ],
  controllers: [CoachController, ProposalsController, MemoryInsightsController],
  providers: [
    ContextAssemblerService,
    CoachConversationsService,
    CoachService,
    ProposalsService,
    MemoryInsightsService,
    PatternAnalysisService,
  ],
  exports: [
    ContextAssemblerService,
    ProposalsService,
    CoachService,
    MemoryInsightsService,
    PatternAnalysisService,
  ],
})
export class CoachModule {}
