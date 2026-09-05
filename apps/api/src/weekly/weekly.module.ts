import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CoachModule } from '../coach/coach.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { PathModule } from '../path/path.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { AggregationService } from './aggregation.service';
import { WeeklyPlanController } from './weekly-plan.controller';
import { WeeklyPlanService } from './weekly-plan.service';
import { WeeklyReviewController } from './weekly-review.controller';
import { WeeklyReviewService } from './weekly-review.service';
import { WeeklyReviewTask } from './weekly-review.task';
import { WeeklySettingsController } from './weekly-settings.controller';
import { WeeklySettingsService } from './weekly-settings.service';

/**
 * The weekly loop (epic E10).
 *
 * `CoachModule` is imported for three things and no more: the context
 * assembler, `ProposalsService` (the only writer of plan-change proposals) and
 * the memory proposer this epic re-triggers after a review.
 *
 * `PathModule` arrives with E10-03 for `DomainModesService` and the routine
 * reads that materialisation needs. It also exports `PlanVersionsService`, and
 * NOTHING HERE MAY INJECT IT: a plan changes only through
 * `POST /proposals/:id/accept` (PRD §15, §89). `WeeklyReviewService` takes the
 * gateway and the proposal service and no version writer at all, which is the
 * structural half of that promise.
 *
 * `NotificationsModule` is absent for the same kind of reason. "Your week is
 * ready to review" (PRD §60's N8) is raised by E12's candidate scanner reading
 * `weekly_reviews`, so that it passes through quiet hours and the caps like
 * every other coaching message — not announced from here.
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    CoachModule,
    UserProfileModule,
    PathModule,
    CommitmentsModule,
  ],
  controllers: [WeeklyReviewController, WeeklySettingsController, WeeklyPlanController],
  providers: [
    AggregationService,
    WeeklyReviewService,
    WeeklySettingsService,
    WeeklyPlanService,
    WeeklyReviewTask,
  ],
  exports: [WeeklyReviewService, AggregationService],
})
export class WeeklyModule {}
