import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CoachModule } from '../coach/coach.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { AggregationService } from './aggregation.service';
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
 * the memory proposer this epic re-triggers after a review. `PathModule` is
 * NOT imported here on purpose — nothing in this module may reach
 * `PlanVersionsService`, and the import list is where that is visible.
 *
 * `NotificationsModule` is absent for the same kind of reason. "Your week is
 * ready to review" (PRD §60's N8) is raised by E12's candidate scanner reading
 * `weekly_reviews`, so that it passes through quiet hours and the caps like
 * every other coaching message — not announced from here.
 */
@Module({
  imports: [PrismaModule, AiModule, CoachModule, UserProfileModule],
  controllers: [WeeklyReviewController, WeeklySettingsController],
  providers: [AggregationService, WeeklyReviewService, WeeklySettingsService, WeeklyReviewTask],
  exports: [WeeklyReviewService, AggregationService],
})
export class WeeklyModule {}
