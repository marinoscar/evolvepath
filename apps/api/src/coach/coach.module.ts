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
import { PROPOSAL_EFFECT } from './proposals/proposal-effects';
import { WorkoutProposalEffect } from '../workouts/adaptation/workout-proposal-effects';
import { SafetyModule } from './safety/safety.module';
import { ActivityModule } from '../progress/comeback/activity.module';

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
    // A coaching turn is behaviour (#112).
    ActivityModule,
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
    // The Health domain's half of accepting a workout proposal (issue #88).
    // Registered HERE rather than in WorkoutsModule because the effect is
    // consumed by ProposalsService: having WorkoutsModule provide it would put
    // a module cycle between the two, for a class that needs nothing but the
    // transaction it is handed.
    //
    // Nest has no multi-provider, so the token IS the array. A second domain
    // effect is one more entry in this factory — which is a smaller change than
    // the `case 'WORKOUT'` in `accept` that this exists to avoid.
    WorkoutProposalEffect,
    {
      provide: PROPOSAL_EFFECT,
      useFactory: (workout: WorkoutProposalEffect) => [workout],
      inject: [WorkoutProposalEffect],
    },
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
